import { signal, computed, effect, batch } from "signals";

const app = document.querySelector<HTMLDivElement>("#app")!;

app.innerHTML = `
  <main>
    <header>
      <h1>signals</h1>
      <p>fine-grained сигналы — изменение трогает только зависимый узел DOM, не весь компонент</p>
    </header>

    <section>
      <h2>Счётчик</h2>
      <div class="row">
        <button id="dec">−</button>
        <span class="big" id="count">0</span>
        <button id="inc">+</button>
      </div>
      <p>удвоенное (computed): <b id="doubled">0</b></p>
      <p>чётность (computed): <b id="parity">—</b></p>
      <p class="muted">пересчётов doubled: <span id="dRuns">0</span> · parity: <span id="pRuns">0</span></p>
    </section>

    <section>
      <h2>Ромб (diamond)</h2>
      <p>a → b, a → c, (b, c) → d. При изменении a узел d обязан пересчитаться ровно один раз.</p>
      <div class="row">
        <button id="aDec">a −</button>
        <span class="big" id="a">0</span>
        <button id="aInc">a +</button>
      </div>
      <p>d = b + c = <b id="d">0</b></p>
      <p class="muted">всего пересчётов тела d: <span id="dCalc">0</span> (растёт на 1 за изменение)</p>
    </section>

    <section>
      <h2>batch</h2>
      <p>пять записей подряд против пяти в batch. Эффект справа считает свои запуски.</p>
      <div class="row">
        <button id="plain">5 записей подряд</button>
        <button id="batched">5 в batch</button>
        <span class="muted">x = <b id="x">0</b> · запусков эффекта: <b id="xRuns">0</b></span>
      </div>
    </section>
  </main>
`;

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => app.querySelector<T>(sel)!;
const text = (sel: string, v: unknown) => ($(sel).textContent = String(v));

const count = signal(0);
let doubledRuns = 0;
let parityRuns = 0;
const doubled = computed(() => {
  doubledRuns++;
  return count.value * 2;
});
const parity = computed(() => {
  parityRuns++;
  return count.value % 2 === 0 ? "чёт" : "нечёт";
});

effect(() => text("#count", count.value));
effect(() => {
  text("#doubled", doubled.value);
  text("#dRuns", doubledRuns);
});
effect(() => {
  text("#parity", parity.value);
  text("#pRuns", parityRuns);
});

$("#inc").onclick = () => (count.value += 1);
$("#dec").onclick = () => (count.value -= 1);

const a = signal(0);
let dCalc = 0;
const b = computed(() => a.value + 1);
const c = computed(() => a.value + 10);
const d = computed(() => {
  dCalc++;
  return b.value + c.value;
});

effect(() => text("#a", a.value));
effect(() => {
  text("#d", d.value);
  text("#dCalc", dCalc);
});

$("#aInc").onclick = () => (a.value += 1);
$("#aDec").onclick = () => (a.value -= 1);

const x = signal(0);
let xRuns = 0;
effect(() => {
  x.value;
  xRuns++;
  text("#x", x.value);
  text("#xRuns", xRuns);
});

$("#plain").onclick = () => {
  for (let i = 0; i < 5; i++) x.value += 1;
};
$("#batched").onclick = () => {
  batch(() => {
    for (let i = 0; i < 5; i++) x.value += 1;
  });
};

const style = document.createElement("style");
style.textContent = `
  :root { color-scheme: dark; }
  body { margin: 0; background: #0d1117; color: #e6edf3; font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif; }
  main { max-width: 640px; margin: 40px auto; padding: 0 20px; }
  h1 { margin: 0 0 4px; font-size: 28px; }
  header p { color: #8b949e; margin: 0 0 8px; }
  section { border: 1px solid #21262d; border-radius: 10px; padding: 16px 20px; margin: 16px 0; background: #161b22; }
  h2 { margin: 0 0 10px; font-size: 16px; }
  .row { display: flex; align-items: center; gap: 12px; margin: 10px 0; }
  button { background: #21262d; color: #e6edf3; border: 1px solid #30363d; border-radius: 8px; padding: 6px 14px; font-size: 15px; cursor: pointer; }
  button:hover { background: #30363d; }
  .big { font-size: 22px; font-variant-numeric: tabular-nums; min-width: 40px; text-align: center; }
  .muted { color: #8b949e; font-size: 13px; }
  b { color: #58a6ff; font-variant-numeric: tabular-nums; }
  p { margin: 6px 0; }
`;
document.head.appendChild(style);
