/**
 * Global error handler middleware
 */
const errorHandler = (err, req, res, next) => {
    console.error(`[ERROR] ${err.message}`);
    
    if (process.env.NODE_ENV === 'development') {
        console.error(err.stack);
    }

    const statusCode = err.statusCode || 500;
    const message = process.env.NODE_ENV === 'production' && statusCode === 500
        ? 'Internal Server Error'
        : err.message;

    res.status(statusCode).json({
        success: false,
        error: {
            message,
            statusCode,
            timestamp: new Date().toISOString()
        }
    });
};

module.exports = errorHandler;

