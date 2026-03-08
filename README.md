# signals

Реактивные сигналы с автотрекингом зависимостей: пересчитывается только то, что реально читало изменившееся значение. Маленькое ядро плюс адаптер под React.

```ts
import { signal, computed, effect } from "signals";

const count = signal(0);
const doubled = computed(() => count.value * 2);

effect(() => console.log(doubled.value)); // 0
count.value = 5;                           // 10
```

`batch(() => …)` склеивает несколько записей в один прогон эффектов, `untracked(() => …)` читает значение без подписки на него. Никаких массивов зависимостей руками — граф строится сам по факту чтения.

Под React — `useSignal`, `useComputed`, `useSignalValue` из `signals/react`:

```tsx
import { useSignal, useComputed, useSignalValue } from "signals/react";

function Counter() {
  const count = useSignal(0);
  const doubled = useComputed(() => count.value * 2);
  return <button onClick={() => count.value++}>{useSignalValue(doubled)}</button>;
}
```

Тесты — `pnpm test`, наглядная демка (счётчик, ромб зависимостей, batch) — в `demo/`.
