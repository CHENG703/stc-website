const { ensureReady } = require('../server');

module.exports = async (req, res) => {
    try {
        const app = await ensureReady();
        return app(req, res);
    } catch (error) {
        console.error('[Vercel] Function error:', error);
        res.status(500).send(`Server Error: ${error.message}`);
    }
};

module.exports.default = module.exports;
