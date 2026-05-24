const cron = require('node-cron');
const { execFile } = require('child_process');
const path = require('path');
const { logger } = require('@librechat/data-schemas');

let initialized = false;

function logProcessOutput(level, prefix, output) {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    logger[level](`${prefix}: <empty>`);
    return;
  }

  lines.forEach((line) => logger[level](`${prefix}: ${line}`));
}

function initializeMemoryCron() {
  if (initialized) return;
  initialized = true;

  const schedule = process.env.MEMORY_CRON_SCHEDULE || '0 * * * *';
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'vectorize-memories.js');

  const runVectorization = (reason) => {
    logger.info(`[MemoryCron] Starting memory vectorization (${reason})`);
    execFile('node', [scriptPath], (err, stdout, stderr) => {
      if (stdout) {
        logProcessOutput('info', '[MemoryCron] vectorize-memories stdout', stdout);
      } else {
        logger.info('[MemoryCron] vectorize-memories stdout: <empty>');
      }
      if (stderr) {
        logProcessOutput('warn', '[MemoryCron] vectorize-memories stderr', stderr);
      } else {
        logger.info('[MemoryCron] vectorize-memories stderr: <empty>');
      }
      if (err) {
        logger.error('[MemoryCron] Error running vectorize-memories:', err.message);
        return;
      }
      logger.info('[MemoryCron] Memory vectorization complete');
    });
  };

  cron.schedule(schedule, () => runVectorization('scheduled'), {
    scheduled: true,
  });

  logger.info(`[MemoryCron] Scheduled with cron expression: ${schedule}`);
  if (process.env.MEMORY_CRON_RUN_ON_STARTUP !== 'false') {
    runVectorization('startup');
  }
}

module.exports = { initializeMemoryCron };
