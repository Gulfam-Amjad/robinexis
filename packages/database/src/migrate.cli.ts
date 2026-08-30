import { databaseUrlFromEnv, loadDatabaseEnv } from "./env.js";
import { migrate } from "./migrate.js";

loadDatabaseEnv();

const url = databaseUrlFromEnv();
if (!url) {
  console.error("DATABASE_URL required");
  process.exit(1);
}
migrate(url)
  .then(() => console.log("migrate ok"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
