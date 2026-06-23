/**
 * Parses Zepp CSV health export files.
 * Supports PAI, resting heart rate, sleep duration, and SpO2.
 * 
 * @param {string} text CSV file contents
 * @returns {Object|null} Aggregated averages of metrics or null if invalid
 */
export function parseZeppCSV(text) {
  if (!text || typeof text !== "string") return null;

  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length < 2) return null;

  // Detect delimiter (comma or semicolon)
  const firstLine = lines[0];
  const delimiter = firstLine.includes(";") ? ";" : ",";

  // Parse header and find indices
  const header = firstLine.toLowerCase();
  const cols = header.split(delimiter).map(c => c.trim().replace(/"/g, ""));

  const paiIdx = cols.findIndex(c => c.includes("pai") || c.includes("activity_score"));
  const hrIdx = cols.findIndex(c => c.includes("heart") || c.includes("resting") || c === "hr" || c.includes("pulse"));
  const sleepIdx = cols.findIndex(c => c.includes("sleep") || c.includes("slp") || c.includes("bedtime"));
  const spo2Idx = cols.findIndex(c => c.includes("oxygen") || c.includes("spo2") || c.includes("sat"));

  const rows = lines.slice(1).map(line => {
    // Split row respecting quotes (in case headers or values contain commas inside quotes)
    let parts = [];
    if (delimiter === ",") {
      // Regex to split comma-separated values, respecting double quotes
      const matches = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
      parts = matches ? matches.map(m => m.replace(/^"|"$/g, "").trim()) : line.split(",");
    } else {
      parts = line.split(";").map(p => p.trim().replace(/"/g, ""));
    }

    return {
      pai: paiIdx >= 0 ? parseFloat(parts[paiIdx]) : null,
      hr: hrIdx >= 0 ? parseFloat(parts[hrIdx]) : null,
      sleep: sleepIdx >= 0 ? parseFloat(parts[sleepIdx]) : null,
      spo2: spo2Idx >= 0 ? parseFloat(parts[spo2Idx]) : null,
    };
  }).filter(r => Object.values(r).some(v => v !== null && !isNaN(v)));

  if (rows.length === 0) return null;

  const avg = (arr, key) => {
    const vals = arr.map(r => r[key]).filter(v => v !== null && !isNaN(v));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };

  // Sleep is often stored in minutes in Zepp CSV exports. 
  // If the average sleep hours is > 24, we assume it's in minutes and divide by 60.
  let avgSleep = avg(rows, "sleep");
  if (avgSleep !== null && avgSleep > 24) {
    avgSleep = avgSleep / 60;
  }

  return {
    pai7day: avg(rows.slice(-7), "pai"),
    restingHR: avg(rows, "hr"),
    sleepHours: avgSleep !== null ? parseFloat(avgSleep.toFixed(1)) : null,
    spo2: avg(rows, "spo2"),
  };
}
