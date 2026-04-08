const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class KeyStorage {
  constructor(filePath) {
    this.filePath = filePath || path.join(require('os').homedir(), '.anz-video-publisher', 'api-keys.enc');
    this.encryptionKey = this.getMachineKey();
  }

  getMachineKey() {
    const machineId = require('os').hostname() + require('os').userInfo().username;
    return crypto.createHash('sha256').update(machineId).digest();
  }

  async saveKeys(apiKeys) {
    const data = JSON.stringify(apiKeys);
    const encrypted = this.encrypt(data);
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, encrypted, 'utf-8');
  }

  async loadKeys() {
    try {
      const encrypted = await fs.readFile(this.filePath, 'utf-8');
      const decrypted = this.decrypt(encrypted);
      return JSON.parse(decrypted);
    } catch {
      return [];
    }
  }

  encrypt(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  }

  decrypt(text) {
    const [ivHex, authTagHex, encrypted] = text.split(':');
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm', 
      this.encryptionKey, 
      Buffer.from(ivHex, 'hex')
    );
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}

module.exports = KeyStorage;
