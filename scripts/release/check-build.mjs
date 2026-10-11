import {readFileSync} from 'node:fs';
import {checkBuiltRoutes} from './guard.mjs';
const contract=JSON.parse(readFileSync(new URL('./contract.json',import.meta.url),'utf8'));
checkBuiltRoutes(process.cwd(),contract.routes);
