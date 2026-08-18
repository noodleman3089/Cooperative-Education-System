import { Pool, PoolConfig, types } from 'pg';
import dotenv from 'dotenv';

// Return DATE (OID 1082) as a plain YYYY-MM-DD string to prevent timezone/UTC shifts in Node
types.setTypeParser(1082, (val) => val);

dotenv.config();

const config: PoolConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_DATABASE || 'coop_edu_db',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};

const pool = new Pool(config);

pool.on('error', (err) => {
  console.error('Unexpected error on idle database client', err);
});

export const query = async (text: string, params?: unknown[]) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.DB_DEBUG === 'true') {
      console.log('Executed query', { text: text.substring(0, 200), duration, rows: res.rowCount });
    }
    return res;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
};

export default pool;
