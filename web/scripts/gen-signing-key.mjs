// Prints a new Ed25519 key pair for signing updates.
//   RELEASE_SIGNING_KEY (Vercel env, secret) and the public key for the app.
import crypto from 'node:crypto';

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const pub = publicKey.export({ format: 'der', type: 'spki' });
console.log('RELEASE_SIGNING_KEY=' + privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'));
console.log('UPDATE_PUBLIC_KEY=' + pub.subarray(pub.length - 32).toString('base64'));
