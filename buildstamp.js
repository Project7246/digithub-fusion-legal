// Written once per deploy, during the build step, and read back when the server
// starts. DigitalOcean builds and then launches the process, so this stamp changes
// on a deploy and stays the same across a restart - which is exactly what the open
// pages are watching for when they decide to show "Update installed".
import { writeFileSync } from 'node:fs';

writeFileSync('.build-id', String(Date.now()));
