const { ensureReady } = require('../server');

module.exports = async (req, res) => {
    const app = await ensureReady();
    return app(req, res);
};

module.exports.default = module.exports;
