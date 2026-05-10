const mysql = require('mysql2/promise');

class Database {
    constructor() {
        this.pool = null;
        this.isConnected = false;
    }

    async initialize() {
        try {
            this.pool = mysql.createPool({
                host: process.env.DB_HOST || 'localhost',
                port: parseInt(process.env.DB_PORT) || 3306,
                user: process.env.DB_USER || 'root',
                password: process.env.DB_PASSWORD || '',
                database: process.env.DB_NAME || 'sofascore_analytics',
                connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 20,
                waitForConnections: true,
                queueLimit: 0,
                charset: 'utf8mb4'
            });

            const connection = await this.pool.getConnection();
            console.log('✅ Database connected successfully');
            connection.release();
            this.isConnected = true;
            return this.pool;
        } catch (error) {
            console.error('❌ Database connection failed:', error.message);
            throw error;
        }
    }

    async query(sql, params = []) {
        if (!this.pool) {
            throw new Error('Database not initialized. Call initialize() first.');
        }
        const [results] = await this.pool.execute(sql, params);
        return results;
    }

    async batchInsert(table, columns, values) {
        if (!values || values.length === 0) return 0;
        const placeholders = columns.map(() => '?').join(',');
        const sql = `INSERT IGNORE INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`;
        const [result] = await this.pool.execute(sql, values);
        return result.affectedRows;
    }

    getPool() { return this.pool; }

    async close() {
        if (this.pool) {
            await this.pool.end();
            this.isConnected = false;
        }
    }
}

module.exports = new Database();

