import { Shift } from '../types';

export const getCurrentShiftId = (shifts: Shift[]): string | null => {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  for (const shift of shifts) {
    const [startH, startM] = shift.startTime.split(':').map(Number);
    const [endH, endM] = shift.endTime.split(':').map(Number);
    const startMin = startH * 60 + startM;
    const endMin = endH * 60 + endM;

    if (endMin < startMin) {
      // Night shift case (crosses midnight)
      if (currentMinutes >= startMin || currentMinutes < endMin) {
        return shift.id;
      }
    } else {
      if (currentMinutes >= startMin && currentMinutes < endMin) {
        return shift.id;
      }
    }
  }
  return null;
};
