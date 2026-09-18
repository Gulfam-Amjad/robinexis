const productionBuild =
  process.env.VERCEL_ENV === "production" ||
  process.env.WEB_PRODUCTION_BUILD === "true";

if (!productionBuild) {
  console.log("Web production environment check skipped for non-production build.");
  process.exit(0);
}

const errors = [];
if (process.env.VITE_SKIP_AUTH === "true") {
  errors.push("VITE_SKIP_AUTH must be false or unset");
}
for (const name of ["VITE_API_BASE_URL", "VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"]) {
  if (!process.env[name]?.trim()) errors.push(`${name} is required`);
}
if (process.env.VITE_API_BASE_URL && !/^https:\/\//.test(process.env.VITE_API_BASE_URL)) {
  errors.push("VITE_API_BASE_URL must use https");
}

if (errors.length) {
  console.error(`Unsafe production web build:\n${errors.map((item) => `- ${item}`).join("\n")}`);
  process.exit(1);
}

console.log("Production web environment is safe to compile.");
