export interface DiceBoxLike { roll(notation: string): Promise<unknown>; clearDice?(): void }

/** Wall-clock budget for the 3D box's init and each roll: the library's own
 * cap counts animation frames, not time, so a stalled WebGL context or a
 * hung roll would otherwise block every later roll's animation forever. */
export const DICE_TIMEOUT_MS = 8000;

let boxPromise: Promise<DiceBoxLike | null> | null = null;

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Rejects with a timeout error if `p` hasn't settled within `ms`. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    p.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/** Lazily creates the 3D dice box once. Resolves to null if 3D isn't possible
 * (no WebGL, reduced motion, load error, or a stalled initialize()). */
export function getDiceBox(): Promise<DiceBoxLike | null> {
  boxPromise ??= (async () => {
    try {
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
      if (!document.createElement("canvas").getContext("webgl2")) return null;
      const { default: DiceBox } = await import("@3d-dice/dice-box-threejs");
      const box = new DiceBox("#dice-stage", {
        sounds: false,
        shadows: true,
        theme_surface: "green-felt",
        theme_material: "metal",
        theme_customColorset: {
          name: "candlelit", foreground: "#ffd27a", background: "#5a3a1c", outline: "#1a120c", texture: "none", material: "metal",
        },
        light_intensity: 0.9,
        gravity_multiplier: 400,
        baseScale: 110,
        strength: 1.4,
      });
      await withTimeout(box.initialize(), DICE_TIMEOUT_MS);
      return box;
    } catch (e) {
      console.warn("3D dice unavailable, using simple dice instead:", e);
      return null;
    }
  })();
  return boxPromise;
}
