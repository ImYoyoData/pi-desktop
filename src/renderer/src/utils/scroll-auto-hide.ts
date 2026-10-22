/**
 * 滚动条空闲隐藏：滚动开始时给滚动容器打标记类，停止滚动后移除，
 * 拇指的淡入淡出交给 CSS。
 *
 * scroll 事件不冒泡，但在捕获阶段可以收到所有后代的滚动，
 * 因此在 document 上以捕获方式监听即可覆盖全部可滚动区域。
 */

const ACTIVE_CLASS = "pi-scroll-active";
const IDLE_DELAY_MS = 700;

const hideTimers = new WeakMap<Element, number>();

let bound = false;

function scheduleHide(target: Element): void {
  const pending = hideTimers.get(target);
  if (pending !== undefined) window.clearTimeout(pending);
  hideTimers.set(
    target,
    window.setTimeout(() => {
      target.classList.remove(ACTIVE_CLASS);
      hideTimers.delete(target);
    }, IDLE_DELAY_MS),
  );
}

/** 注册滚动条自动隐藏。幂等，重复调用只绑定一次。 */
export function bootstrapScrollAutoHide(): void {
  if (bound) return;
  bound = true;
  document.addEventListener(
    "scroll",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      target.classList.add(ACTIVE_CLASS);
      scheduleHide(target);
    },
    true,
  );
}
