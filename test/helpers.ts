import { addIce, addShot, addSyrup, addTopping, emptyBuild, FILL_TARGET, pourLiquid, SHOT_FILL, type Build } from '../src/game/build.ts';
import { SYRUPS, type DrinkSpec } from '../src/game/menu.ts';

/** Build exactly what a spec asks for, with perfect shots and a perfect fill. */
export function perfectBuild(spec: DrinkSpec): Build {
  const b = emptyBuild();
  b.size = spec.size;
  for (let i = 0; i < spec.shots; i++) addShot(b, { quality: 1, grade: 'perfect' });
  if (spec.iced) addIce(b);
  pourLiquid(b, spec.liquid, FILL_TARGET - spec.shots * SHOT_FILL);
  for (const s of SYRUPS) for (let i = 0; i < (spec.syrups[s] ?? 0); i++) addSyrup(b, s);
  for (const t of spec.toppings) addTopping(b, t);
  return b;
}
