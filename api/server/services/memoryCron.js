const cron = require('node-cron');
const { execFile } = require('child_process');
const path = require('path');
const { logger } = require('@librechat/data-schemas');

let initialized = false;

function initializeMemoryCron() {
  if (initialized) return;
  initialized = true;

  const schedule = process.env.MEMORY_CRON_SCHEDULE || '0 * * * *';
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'vectorize-memories.js');

  cron.schedule(schedule, () => {
    logger.info('[MemoryCron] Starting scheduled memory vectorization');
    execFile('node', [scriptPath], (err) => {
      if (err) {
        logger.error('[MemoryCron] Error running vectorize-memories:', err.message);
      } else {
        logger.info('[MemoryCron] Memory vectorization complete');
      }
    });
  }, {
    scheduled: true,
  });

  logger.info(`[MemoryCron] Scheduled with cron expression: ${schedule}`);
}

module.exports = { initializeMemoryCron };
