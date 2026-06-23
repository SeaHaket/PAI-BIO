// ─── Fitness Age & Health Score Algorithm ─────────────────────────────────────

/**
 * Calculates fitness age, score, and delta based on HUNT study parameters
 * and SpO2 metrics.
 * 
 * @param {Object} params
 * @param {number} params.age Chronological age (years)
 * @param {string} params.sex "male" | "female"
 * @param {number} params.pai7day 7-day accumulated PAI score
 * @param {number} params.restingHR Resting Heart Rate (BPM)
 * @param {number} params.sleepHours Average nightly sleep duration (hours)
 * @param {number} params.bmi Body Mass Index (kg/m^2)
 * @param {number} params.spo2 Blood Oxygen Saturation (%)
 */
export function calcFitnessAge({ age, sex, pai7day, restingHR, sleepHours, bmi, spo2 }) {
  let delta = 0;

  // 1. PAI score impact (HUNT study: PAI >= 100 = optimal cardiovascular risk reduction)
  if (pai7day >= 100) delta -= 5;
  else if (pai7day >= 75) delta -= 2;
  else if (pai7day >= 50) delta += 1;
  else if (pai7day >= 25) delta += 4;
  else delta += 8;

  // 2. Resting HR (lower is better; athlete range 40-60)
  if (restingHR <= 55) delta -= 4;
  else if (restingHR <= 65) delta -= 1;
  else if (restingHR <= 75) delta += 1;
  else if (restingHR <= 85) delta += 3;
  else delta += 6;

  // 3. Sleep (7-9 hrs optimal)
  if (sleepHours >= 7 && sleepHours <= 9) delta -= 1;
  else if (sleepHours < 6 || sleepHours > 10) delta += 3;
  else delta += 1;

  // 4. BMI
  if (bmi >= 18.5 && bmi <= 24.9) delta -= 2;
  else if (bmi >= 25 && bmi <= 29.9) delta += 1;
  else if (bmi >= 30) delta += 4;
  else delta += 2; // Underweight or other

  // 5. Blood Oxygen Saturation (SpO2) impact
  if (spo2 >= 95) {
    delta -= 1; // Optimal oxygenation indicates excellent respiratory health
  } else if (spo2 >= 90) {
    delta += 2; // Hypoxic stress / poor recovery
  } else if (spo2 > 0) {
    delta += 4; // Critical hypoxic state
  }

  // 6. Sex adjustment (women biologically younger cardiovascular age on average)
  if (sex === "female") delta -= 1;

  const fitnessAge = Math.max(18, Math.min(90, age + delta));
  const score = Math.max(0, Math.min(100, 100 - (delta * 4.5))); // Adjusted scale factor for SpO2 inclusion

  return {
    fitnessAge: Math.round(fitnessAge),
    delta,
    score: Math.round(score)
  };
}

/**
 * Calculates BMI
 * @param {number} weight Weight in kg
 * @param {number} height Height in cm
 */
export function calcBMI(weight, height) {
  if (!weight || !height) return null;
  const bmi = weight / Math.pow(height / 100, 2);
  return parseFloat(bmi.toFixed(1));
}
