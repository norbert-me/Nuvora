import { useState, useEffect, useRef } from 'react';
import { IconStar, IconParty } from './Icons';

const DIRECTIONS = {
  right: [0, 1],
  down: [1, 0],
  left: [0, -1],
  up: [-1, 0],
};

const TURN_RIGHT = { right: 'down', down: 'left', left: 'up', up: 'right' };
const TURN_LEFT = { right: 'up', up: 'left', left: 'down', down: 'right' };

const DIR_EMOJI = { right: '▶', down: '▼', left: '◀', up: '▲' };

export function MazeRunner({ maze, commands, running, onFinish }) {
  const [pos, setPos] = useState(maze.start);
  const [dir, setDir] = useState(maze.direction);
  const [visited, setVisited] = useState([maze.start]);
  const [step, setStep] = useState(-1);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!running) {
      setPos([...maze.start]);
      setDir(maze.direction);
      setVisited([maze.start]);
      setStep(-1);
      setError(null);
      setSuccess(false);
      return;
    }

    const flatCmds = flattenCommands(commands);
    let currentPos = [...maze.start];
    let currentDir = maze.direction;
    let visitedCells = [[...maze.start]];
    let i = 0;

    timerRef.current = setInterval(() => {
      if (i >= flatCmds.length) {
        clearInterval(timerRef.current);
        if (currentPos[0] === maze.goal[0] && currentPos[1] === maze.goal[1]) {
          setSuccess(true);
          onFinish?.(true);
        } else {
          setError('Die Figur hat das Ziel nicht erreicht!');
          onFinish?.(false);
        }
        return;
      }

      const cmd = flatCmds[i];
      if (cmd === 'gehe vorwärts') {
        const delta = DIRECTIONS[currentDir];
        const newRow = currentPos[0] + delta[0];
        const newCol = currentPos[1] + delta[1];
        if (
          newRow < 0 || newRow >= maze.grid.length ||
          newCol < 0 || newCol >= maze.grid[0].length ||
          maze.grid[newRow][newCol] === 1
        ) {
          clearInterval(timerRef.current);
          setError('Bumm! Gegen die Wand gelaufen!');
          onFinish?.(false);
          return;
        }
        currentPos = [newRow, newCol];
        visitedCells = [...visitedCells, [...currentPos]];
        setPos([...currentPos]);
        setVisited([...visitedCells]);
      } else if (cmd === 'drehe rechts') {
        currentDir = TURN_RIGHT[currentDir];
        setDir(currentDir);
      } else if (cmd === 'drehe links') {
        currentDir = TURN_LEFT[currentDir];
        setDir(currentDir);
      }

      setStep(i);
      i++;
    }, 400);

    return () => clearInterval(timerRef.current);
  }, [running]);

  const rows = maze.grid.length;
  const cols = maze.grid[0].length;

  return (
    <div>
      <div
        className="maze-grid"
        style={{ gridTemplateColumns: `repeat(${cols}, 48px)`, width: cols * 48 }}
      >
        {maze.grid.map((row, r) =>
          row.map((cell, c) => {
            const isPlayer = pos[0] === r && pos[1] === c;
            const isGoal = maze.goal[0] === r && maze.goal[1] === c;
            const isVisited = visited.some(v => v[0] === r && v[1] === c);
            let className = 'maze-cell';
            if (cell === 1) className += ' wall';
            else if (isGoal && !isPlayer) className += ' goal';
            else if (isVisited) className += ' visited';
            else className += ' path';

            return (
              <div key={`${r}-${c}`} className={className}>
                {isPlayer && <span className="character">{DIR_EMOJI[dir]}</span>}
                {isGoal && !isPlayer && <IconStar size={20} />}
              </div>
            );
          })
        )}
      </div>
      {error && <div className="feedback-wrong" style={{ marginTop: 12 }}>{error}</div>}
      {success && <div className="feedback-correct" style={{ marginTop: 12 }}><IconParty size={18} /> Geschafft! Ziel erreicht!</div>}
    </div>
  );
}

function flattenCommands(commands) {
  const result = [];
  for (const cmd of commands) {
    if (cmd.type === 'container' || cmd.type === 'event-container') {
      const countField = cmd.fields?.find(f => f.key === 'count');
      const times = countField ? parseInt(countField.value) || 1 : 1;
      for (let i = 0; i < times; i++) {
        if (cmd.children) {
          result.push(...flattenCommands(cmd.children));
        }
      }
    } else {
      result.push(cmd.label);
    }
  }
  return result;
}
