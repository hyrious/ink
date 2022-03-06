export function input(el, { start, update, finish }) {
  function down(ev) {
    if (ev.button !== 0) return;
    el.setPointerCapture(ev.pointerId);
    el.addEventListener("pointermove", move);
    start();
  }

  function move(ev) {
    update(ev);
  }

  function up(ev) {
    finish();
    el.removeEventListener("pointermove", move);
    el.releasePointerCapture(ev.pointerId);
  }

  el.addEventListener("pointerdown", down);
  el.addEventListener("pointerup", up);

  return {
    unsubscribe() {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointerup", up);
    },
  };
}
