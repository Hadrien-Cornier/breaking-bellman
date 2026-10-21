// Seeded pendulum-tracking comparison inspired by SuperMimic.
// This is an independent teaching engine. It does not participate in RLA.run or Fast results.
(function () {
  'use strict';
  const rngApi = typeof module === 'object' && module.exports ? require('../core/rng.js') : globalThis.RLA.rng;
  const DT = 0.1, ACTION_LIMIT = 2, GAMMA = 0.97;
  const POLICY_DIM = 7, MODEL_DIM = 6, VALUE_DIM = 5;

  function reference(t) {
    return {
      q: 0.9 * Math.sin(0.09 * t) + 0.35 * Math.sin(0.037 * t + 0.4),
      v: 0.81 * Math.cos(0.09 * t) + 0.1295 * Math.cos(0.037 * t + 0.4),
    };
  }
  function reward(next, action, t) {
    const r = reference(t), e = next[0] - r.q, ev = next[1] - r.v;
    return Math.exp(-1.4 * e * e - 0.06 * ev * ev) - 0.01 * action * action;
  }
  function trueStep(state, action) {
    let q = state[0], v = state[1];
    const commanded = Math.max(-ACTION_LIMIT, Math.min(ACTION_LIMIT, action));
    // The small control loop stands in for a rigid-body simulator. Its actuator saturates smoothly.
    const torque = 1.35 * Math.tanh(commanded / 1.35);
    for (let i = 0; i < 4; i++) {
      const acc = 0.9 * torque - 0.42 * v - 3.8 * Math.sin(q);
      v += (DT / 4) * acc;
      q += (DT / 4) * v;
    }
    return [q, v];
  }
  function modelFeatures(state, action) {
    return [1, state[0], state[1], action, Math.sin(state[0]), Math.cos(state[0])];
  }
  function dot(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }
  function solve(a, b) {
    const n = b.length, m = a.map((row, i) => row.slice().concat(b[i]));
    for (let k = 0; k < n; k++) {
      let best = k;
      for (let i = k + 1; i < n; i++) if (Math.abs(m[i][k]) > Math.abs(m[best][k])) best = i;
      [m[k], m[best]] = [m[best], m[k]];
      const pivot = m[k][k] || 1e-12;
      for (let j = k; j <= n; j++) m[k][j] /= pivot;
      for (let i = 0; i < n; i++) if (i !== k) {
        const x = m[i][k];
        for (let j = k; j <= n; j++) m[i][j] -= x * m[k][j];
      }
    }
    return m.map(row => row[n]);
  }
  function ridge(xs, ys, lambda = 1e-5) {
    const d = xs[0].length, a = Array.from({ length: d }, () => Array(d).fill(0)), b = Array(d).fill(0);
    for (let n = 0; n < xs.length; n++) for (let i = 0; i < d; i++) {
      b[i] += xs[n][i] * ys[n];
      for (let j = 0; j < d; j++) a[i][j] += xs[n][i] * xs[n][j];
    }
    for (let i = 0; i < d; i++) a[i][i] += lambda;
    return solve(a, b);
  }
  function fitModel(seed = 178, count = 2400) {
    const random = rngApi.make(seed), xs = [], yq = [], yv = [];
    const started = Date.now();
    let state = [random.uniform(-1.2, 1.2), random.uniform(-1.5, 1.5)];
    for (let i = 0; i < count; i++) {
      if (i % 40 === 0) state = [random.uniform(-1.2, 1.2), random.uniform(-1.5, 1.5)];
      // The logged controller stays inside this support. Learned-model policies may leave it.
      const action = random.uniform(-0.35, 0.35);
      const next = trueStep(state, action), x = modelFeatures(state, action);
      xs.push(x); yq.push(next[0] - state[0]); yv.push(next[1] - state[1]); state = next;
    }
    const wq = ridge(xs, yq), wv = ridge(xs, yv);
    const model = {
      seed, count, actionSupport: 0.35, wq, wv,
      step(state, action) {
        const x = modelFeatures(state, action);
        return [state[0] + dot(wq, x), state[1] + dot(wv, x)];
      },
    };
    let mse = 0;
    for (let i = 0; i < xs.length; i++) {
      const p = [dot(wq, xs[i]), dot(wv, xs[i])];
      mse += (p[0] - yq[i]) ** 2 + (p[1] - yv[i]) ** 2;
    }
    model.fitMs = Date.now() - started;
    model.trainMse = mse / xs.length;
    model.id = JSON.stringify([seed, count, wq.map(x => +x.toFixed(10)), wv.map(x => +x.toFixed(10))]);
    return model;
  }
  function policyFeatures(state, t) {
    const r = reference(t);
    return [1, state[0], state[1], r.q, r.v, state[0] - r.q, state[1] - r.v];
  }
  function valueFeatures(state, t) {
    const r = reference(t), e = state[0] - r.q, ev = state[1] - r.v;
    return [1, e, ev, e * e, ev * ev];
  }
  function actionOf(theta, state, t, noise = 0) {
    return ACTION_LIMIT * Math.tanh(dot(theta, policyFeatures(state, t)) + noise);
  }
  function startState(random, t) {
    const r = reference(t);
    return [r.q + random.uniform(-0.45, 0.45), r.v + random.uniform(-0.6, 0.6)];
  }
  function evaluate(theta, step, seed = 9001, episodes = 12, horizon = 100) {
    const random = rngApi.make(seed);
    let total = 0, outside = 0, actions = 0;
    for (let ep = 0; ep < episodes; ep++) {
      let t = random.int(300), state = startState(random, t), sum = 0;
      for (let k = 0; k < horizon; k++, t++) {
        const action = actionOf(theta, state, t);
        if (Math.abs(action) > 0.35) outside++;
        actions++;
        state = step(state, action); sum += reward(state, action, t + 1);
      }
      total += sum / horizon;
    }
    return { score: total / episodes, outsideSupport: outside / actions };
  }
  function fitCritic(theta, step, random, episodes = 12, horizon = 55) {
    const xs = [], ys = [];
    for (let ep = 0; ep < episodes; ep++) {
      let t = random.int(300), state = startState(random, t);
      const states = [], rewards = [];
      for (let k = 0; k < horizon; k++, t++) {
        states.push([state, t]);
        const action = actionOf(theta, state, t);
        state = step(state, action); rewards.push(reward(state, action, t + 1));
      }
      let ret = 0;
      for (let k = horizon - 1; k >= 0; k--) {
        ret = rewards[k] + GAMMA * ret;
        xs.push(valueFeatures(states[k][0], states[k][1])); ys.push(ret);
      }
    }
    return ridge(xs, ys, 0.1);
  }
  function trainPPO(step, seed, updates = 28) {
    const random = rngApi.make(seed), theta = Array(POLICY_DIM).fill(0), critic = Array(VALUE_DIM).fill(0);
    const sigma = 0.34, horizon = 48, episodes = 12, curves = [], started = Date.now();
    const initial = evaluate(theta, trueStep, seed + 5000, 8).score;
    let sampledSteps = 0;
    for (let update = 0; update < updates; update++) {
      const batch = [];
      for (let ep = 0; ep < episodes; ep++) {
        let t = random.int(300), state = startState(random, t);
        const trajectory = [];
        for (let k = 0; k < horizon; k++, t++) {
          const phi = policyFeatures(state, t), mean = dot(theta, phi), latent = mean + sigma * random.normal();
          const action = ACTION_LIMIT * Math.tanh(latent), vf = valueFeatures(state, t);
          const next = step(state, action), r = reward(next, action, t + 1);
          trajectory.push({ phi, vf, latent, oldMean: mean, reward: r, value: dot(critic, vf), state, t });
          state = next; sampledSteps++;
        }
        let ret = dot(critic, valueFeatures(state, t));
        for (let k = trajectory.length - 1; k >= 0; k--) {
          ret = trajectory[k].reward + GAMMA * ret;
          trajectory[k].ret = ret; trajectory[k].adv = ret - trajectory[k].value;
        }
        batch.push(...trajectory);
      }
      const meanAdv = batch.reduce((s, x) => s + x.adv, 0) / batch.length;
      const sdAdv = Math.sqrt(batch.reduce((s, x) => s + (x.adv - meanAdv) ** 2, 0) / batch.length) + 1e-8;
      for (const x of batch) x.adv = (x.adv - meanAdv) / sdAdv;
      for (let epoch = 0; epoch < 3; epoch++) {
        const grad = Array(POLICY_DIM).fill(0), vg = Array(VALUE_DIM).fill(0);
        for (const x of batch) {
          const mean = dot(theta, x.phi);
          const logRatio = -0.5 * ((x.latent - mean) / sigma) ** 2 + 0.5 * ((x.latent - x.oldMean) / sigma) ** 2;
          const ratio = Math.exp(Math.max(-10, Math.min(10, logRatio)));
          const clipped = (x.adv >= 0 && ratio > 1.2) || (x.adv < 0 && ratio < 0.8);
          if (!clipped) {
            const scale = x.adv * ratio * (x.latent - mean) / (sigma * sigma);
            for (let i = 0; i < POLICY_DIM; i++) grad[i] += scale * x.phi[i] / batch.length;
          }
          const err = x.ret - dot(critic, x.vf);
          for (let i = 0; i < VALUE_DIM; i++) vg[i] += err * x.vf[i] / batch.length;
        }
        let norm = Math.sqrt(grad.reduce((s, x) => s + x * x, 0));
        const clip = norm > 1 ? 1 / norm : 1;
        for (let i = 0; i < POLICY_DIM; i++) theta[i] += 0.018 * clip * grad[i];
        for (let i = 0; i < VALUE_DIM; i++) critic[i] += 0.025 * Math.max(-1, Math.min(1, vg[i]));
      }
      if (update % 4 === 3 || update === updates - 1) curves.push({ update: update + 1, physics: evaluate(theta, trueStep, seed + 5000, 8).score });
    }
    return { theta, sampledSteps, updates, trainMs: Date.now() - started, initial, curves, gradient: 'likelihood-ratio PPO' };
  }
  function modelJacobians(model, state) {
    const q = state[0], rows = [model.wq, model.wv];
    return rows.map((w, row) => ({
      q: (row === 0 ? 1 : 0) + w[1] + w[4] * Math.cos(q) - w[5] * Math.sin(q),
      v: (row === 1 ? 1 : 0) + w[2],
      a: w[3],
    }));
  }
  function bpttGradient(theta, critic, model, starts, horizon = 12) {
    const grad = Array(POLICY_DIM).fill(0);
    let objective = 0;
    for (const start of starts) {
      let state = start.state.slice(), t = start.t;
      const tape = [];
      for (let k = 0; k < horizon; k++, t++) {
        const phi = policyFeatures(state, t), z = dot(theta, phi), tanh = Math.tanh(z), action = ACTION_LIMIT * tanh;
        const next = model.step(state, action), r = reward(next, action, t + 1);
        tape.push({ state, next, t, phi, action, da: ACTION_LIMIT * (1 - tanh * tanh), jac: modelJacobians(model, state) });
        objective += (GAMMA ** k) * r / starts.length;
        state = next;
      }
      const terminal = valueFeatures(state, t), rt = reference(t), e = state[0] - rt.q, ev = state[1] - rt.v;
      let adj = [(GAMMA ** horizon) * (critic[1] + 2 * critic[3] * e), (GAMMA ** horizon) * (critic[2] + 2 * critic[4] * ev)];
      objective += (GAMMA ** horizon) * dot(critic, terminal) / starts.length;
      for (let k = horizon - 1; k >= 0; k--) {
        const x = tape[k], r = reference(x.t + 1), e2 = x.next[0] - r.q, ev2 = x.next[1] - r.v;
        const track = Math.exp(-1.4 * e2 * e2 - 0.06 * ev2 * ev2), discount = GAMMA ** k;
        const localNext = [adj[0] + discount * track * -2.8 * e2, adj[1] + discount * track * -0.12 * ev2];
        const ga = discount * -0.02 * x.action + localNext[0] * x.jac[0].a + localNext[1] * x.jac[1].a;
        for (let i = 0; i < POLICY_DIM; i++) grad[i] += ga * x.da * x.phi[i] / starts.length;
        const dzq = theta[1] + theta[5], dzv = theta[2] + theta[6];
        adj = [
          localNext[0] * x.jac[0].q + localNext[1] * x.jac[1].q + ga * x.da * dzq,
          localNext[0] * x.jac[0].v + localNext[1] * x.jac[1].v + ga * x.da * dzv,
        ];
      }
    }
    return { grad, objective };
  }
  function trainBPTT(model, seed, updates = 42) {
    const random = rngApi.make(seed), theta = Array(POLICY_DIM).fill(0), curves = [], started = Date.now();
    const initial = evaluate(theta, trueStep, seed + 5000, 8).score;
    let imaginedSteps = 0, critic = Array(VALUE_DIM).fill(0);
    for (let update = 0; update < updates; update++) {
      critic = fitCritic(theta, model.step, random, 7, 42);
      imaginedSteps += 7 * 42;
      const starts = Array.from({ length: 16 }, () => {
        const t = random.int(300);
        return { t, state: startState(random, t) };
      });
      const g = bpttGradient(theta, critic, model, starts, 12); imaginedSteps += starts.length * 12;
      const norm = Math.sqrt(g.grad.reduce((s, x) => s + x * x, 0)), scale = norm > 6 ? 6 / norm : 1;
      for (let i = 0; i < POLICY_DIM; i++) theta[i] += 0.0035 * scale * g.grad[i];
      if (update % 6 === 5 || update === updates - 1) curves.push({ update: update + 1, physics: evaluate(theta, trueStep, seed + 5000, 8).score });
    }
    return { theta, critic, sampledSteps: imaginedSteps, updates, trainMs: Date.now() - started, initial, curves, gradient: 'analytic BPTT, horizon 12 + terminal critic' };
  }
  function gradientCheck(model, seed = 8) {
    const random = rngApi.make(seed), theta = Array.from({ length: POLICY_DIM }, () => random.uniform(-0.1, 0.1));
    const critic = Array.from({ length: VALUE_DIM }, () => random.uniform(-0.1, 0.1));
    const starts = [{ t: 17, state: [0.2, -0.1] }], analytic = bpttGradient(theta, critic, model, starts, 5).grad;
    const numeric = [], eps = 1e-5;
    for (let i = 0; i < theta.length; i++) {
      const hi = theta.slice(), lo = theta.slice(); hi[i] += eps; lo[i] -= eps;
      numeric.push((bpttGradient(hi, critic, model, starts, 5).objective - bpttGradient(lo, critic, model, starts, 5).objective) / (2 * eps));
    }
    const maxError = Math.max(...analytic.map((x, i) => Math.abs(x - numeric[i])));
    return { analytic, numeric, maxError };
  }
  function benchmark(model, steps = 80000) {
    let state = [0.2, 0], checksum = 0, started = performance.now ? performance.now() : Date.now();
    for (let i = 0; i < steps; i++) { state = trueStep(state, Math.sin(i)); checksum += state[0] * 1e-12; }
    const physicsMs = (performance.now ? performance.now() : Date.now()) - started;
    state = [0.2, 0]; started = performance.now ? performance.now() : Date.now();
    for (let i = 0; i < steps; i++) { state = model.step(state, Math.sin(i)); checksum += state[0] * 1e-12; }
    const modelMs = (performance.now ? performance.now() : Date.now()) - started;
    return { steps, physicsMs, modelMs, physicsStepsPerSecond: 1000 * steps / physicsMs, modelStepsPerSecond: 1000 * steps / modelMs, checksum };
  }
  function summarize(name, train, model, seed) {
    const physics = evaluate(train.theta, trueStep, seed + 7000), surrogate = evaluate(train.theta, model.step, seed + 7000);
    return {
      name, optimizer: train.gradient, trainingSteps: train.sampledSteps, updates: train.updates, trainMs: train.trainMs,
      initialPhysicsScore: train.initial, physicsScore: physics.score, surrogateScore: surrogate.score,
      surrogateMinusPhysics: surrogate.score - physics.score, outsideSupport: surrogate.outsideSupport,
      trueGainPer1000Steps: 1000 * (physics.score - train.initial) / train.sampledSteps,
      modelId: model.id, curve: train.curves,
    };
  }
  function compare(seed = 178, scale = 1) {
    const model = fitModel(seed, 2400), ppoUpdates = Math.round(28 * scale), bpttUpdates = Math.round(42 * scale);
    const physicsPpo = trainPPO(trueStep, seed + 1, ppoUpdates);
    const modelPpo = trainPPO(model.step, seed + 1, ppoUpdates);
    const bptt = trainBPTT(model, seed + 1, bpttUpdates);
    const methods = [
      summarize('PPO in physics', physicsPpo, model, seed),
      summarize('PPO in learned model', modelPpo, model, seed),
      summarize('Backprop through learned model', bptt, model, seed),
    ];
    const learned = methods.slice(1), exploit = learned.reduce((a, b) => b.surrogateMinusPhysics > a.surrogateMinusPhysics ? b : a);
    return {
      seed, scale, model: { id: model.id, fitTransitions: model.count, fitMs: model.fitMs, trainMse: model.trainMse, actionSupport: model.actionSupport },
      methods, rollout: benchmark(model), exploit: {
        method: exploit.name, surrogateScore: exploit.surrogateScore, physicsScore: exploit.physicsScore,
        gap: exploit.surrogateMinusPhysics, outsideSupport: exploit.outsideSupport,
        cause: 'The model was fitted only on actions from -0.35 to 0.35. It extrapolates a near-linear actuator, while physics saturates the actuator.',
      },
    };
  }
  const api = { DT, ACTION_LIMIT, reference, reward, trueStep, modelFeatures, fitModel, evaluate, trainPPO, trainBPTT, bpttGradient, gradientCheck, benchmark, compare };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.BBSUPERMIMIC = api;
})();
