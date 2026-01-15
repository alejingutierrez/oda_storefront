import 'dotenv/config';
import { Queue, Worker } from 'bullmq';

const connection = { url: process.env.REDIS_URL || 'redis://localhost:6379' };
const queueName = process.env.WORK_QUEUE || 'ingestion';

const queue = new Queue(queueName, { connection });

const worker = new Worker(queueName, async (job) => {
  console.log('[worker-stub] processing job', job.id, job.name);
  // Placeholder: real pipeline will call GPT-5.2 and persist in Neon.
}, { connection });

worker.on('completed', (job) => console.log('[worker-stub] completed', job.id));
worker.on('failed', (job, err) => console.error('[worker-stub] failed', job?.id, err));

// seed a demo job
queue.add('demo', { hello: 'world' }).catch((err) => console.error('queue add error', err));
