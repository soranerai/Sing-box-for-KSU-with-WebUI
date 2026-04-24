import { shellQuote, META_PATH, AUTOUPDATE_LIST, Toast, MOD_PATH } from './utils.js';

export class Api {
  static async exec(cmd) {
    try {
      const k = window.ksu || ksu;
      if (!k || !k.exec) {
        throw new Error("API KernelSU недоступен.");
      }
      const raw = await k.exec(cmd);
      if (raw && typeof raw === 'object' && 'stdout' in raw) {
        return raw.stdout;
      }
      return raw;
    } catch (e) {
      console.error('[API Error]', e);
      return 'error';
    }
  }

  static async loadMetadata() {
    const defaultMeta = { serviceStart: 0, configs: {} };
    try {
      const res = await this.exec(`[ -f ${shellQuote(META_PATH)} ] && cat ${shellQuote(META_PATH)} || echo '{}'`);
      if (res === 'error') return defaultMeta;
      
      const parsed = JSON.parse(res || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return defaultMeta;
      }
      
      return {
        ...defaultMeta,
        ...parsed,
        configs: { ...defaultMeta.configs, ...(parsed.configs || {}) }
      };
    } catch (e) {
      return defaultMeta;
    }
  }

  static async saveMetadata(data) {
    try {
      const json = JSON.stringify(data);
      await this.exec(`cat > ${shellQuote(META_PATH)} <<'EOF'\n${json}\nEOF`);
    } catch (e) {}
  }
}

export const Debug = {
  async log(msg, data = '') {
    const text = `[${new Date().toLocaleTimeString()}] ${msg} ${typeof data === 'object' ? JSON.stringify(data) : data}`;
    console.log(text);
    try {
      const k = window.ksu || ksu;
      if (k && k.exec) {
        await k.exec(`echo ${shellQuote(text)} >> ${MOD_PATH}/debug.log`);
      }
    } catch(e) {}
  }
};
