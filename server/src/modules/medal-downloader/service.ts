import { MedalProvider } from './provider.js';
import { MedalJobManager } from './jobManager.js';

export const medalProvider = new MedalProvider();
export const medalJobManager = new MedalJobManager(medalProvider);
