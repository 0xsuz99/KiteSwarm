const TRUTHY_VALUES = new Set(["1", "true", "yes", "on"]);

function isTruthy(value: string | undefined) {
  if (!value) {
    return false;
  }
  return TRUTHY_VALUES.has(value.trim().toLowerCase());
}

export function isDemoNoAuthMode() {
  return (
    isTruthy(process.env.DEMO_NO_AUTH) ||
    isTruthy(process.env.NEXT_PUBLIC_DEMO_NO_AUTH)
  );
}

export function demoActorId() {
  return "demo-no-auth";
}
