export interface DiceBoxLike { roll(notation: string): Promise<unknown>; clearDice?(): void }

let boxPromise: Promise<DiceBoxLike | null> | null = null;

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Lazily creates the 3D dice box once. Resolves to null if 3D isn't possible (no WebGL, reduced motion, load error). */
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
      await box.initialize();
      return box;
    } catch (e) {
      console.warn("3D dice unavailable, using simple dice instead:", e);
      return null;
    }
  })();
  return boxPromise;
}
