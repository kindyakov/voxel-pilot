import { PRIORITIES } from "../config/priorities.js";

export const getStatePriority = (stateName) => PRIORITIES[stateName] || 1

export const getCurrentPriority = (stateValue) => {
  const activeStates = extractActiveStates(stateValue);
  const priorities = activeStates
    .map(stateName => getStatePriority(stateName))
    .filter(p => p > 0);

  return Math.max(...priorities, 1);
};

const extractActiveStates = (stateValue) => {
  const states = [];

  const traverse = (value) => {
    if (typeof value === 'string') {
      states.push(value);
    } else if (typeof value === 'object') {
      Object.values(value).forEach(traverse);
    }
  };

  traverse(stateValue);
  return states;
};