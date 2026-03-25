import './styles.css';
import { GameApp } from './game/game';

const appRoot = document.getElementById('app');
if (!appRoot) {
  throw new Error('Missing #app root element');
}

const game = new GameApp(appRoot);
void game.start().catch((error) => {
  console.error(error);
  const message = document.createElement('pre');
  message.className = 'fatal';
  message.textContent = `Startup failed:\n${error instanceof Error ? error.stack ?? error.message : String(error)}`;
  appRoot.append(message);
});
