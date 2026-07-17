export const getAuthRedirectUrl = () => {
  if (typeof window === "undefined") return "/login";
  const returnTo = `${window.location.pathname}${window.location.search}`;
  if (returnTo.startsWith("/login") || returnTo.startsWith("/register")) {
    return "/login";
  }
  return `/login?returnTo=${encodeURIComponent(returnTo)}`;
};
