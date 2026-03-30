export const checkResponseStatus = (stderr: string) => {
  const text = stderr.toLowerCase();

  if (text.includes("unauthorized") || text.includes("forbidden")) {
    return 0;
  } else if (text.includes("notfound") || text.includes("404")) {
    return -1;
  } else if (text.includes("timeout")) {
    return 2;
  } else if (text.includes("tls") || text.includes("x509") || text.includes("certificate")) {
    return 0;
  }

  return 0;
};
