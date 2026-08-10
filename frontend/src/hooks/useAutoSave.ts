import { useState, useEffect } from 'react';

export function useAutoSave<T>(key: string, initialValue: T) {
  const [data, setData] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.warn('Error reading localStorage', error);
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(data));
    } catch (error) {
      console.warn('Error setting localStorage', error);
    }
  }, [key, data]);

  const clearAutoSave = () => {
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      console.warn('Error removing localStorage', error);
    }
  };

  return [data, setData, clearAutoSave] as const;
}
