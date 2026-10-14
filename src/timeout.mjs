export async function withTimeout(operation, message, milliseconds = 15000) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(message);
        error.code = 'operation/timeout';
        reject(error);
      }, milliseconds);
    })]);
  } finally {
    clearTimeout(timer);
  }
}
