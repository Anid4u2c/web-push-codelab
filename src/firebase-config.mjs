const primaryAuthDomain = 'web-push-4u2c.web.app';
const alternateAuthDomain = 'web-push-4u2c.firebaseapp.com';

export function authDomainForHost(hostname) {
  return hostname === alternateAuthDomain ? alternateAuthDomain : primaryAuthDomain;
}

// Firebase web app configuration is public; access is enforced by Auth and rules.
export const firebaseConfig = {
  apiKey: 'AIzaSyCxqt0JCZ8KGOSCA9V_uQ1Z1Ttz5kafDYo',
  authDomain: authDomainForHost(globalThis.location?.hostname),
  databaseURL: 'https://web-push-4u2c.firebaseio.com',
  projectId: 'web-push-4u2c',
  storageBucket: 'web-push-4u2c.firebasestorage.app',
  messagingSenderId: '589537879159',
  appId: '1:589537879159:web:327f526e3ec55246'
};
