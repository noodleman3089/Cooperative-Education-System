import React from 'react';
import DeanSignQueue from '../pages/Dean/DeanSignQueue';
import DeanSignature from '../pages/Dean/DeanSignature';

interface DeanDashboardProps {
  activeMenu?: string;
  defaultTab?: string;
}

const DeanDashboard: React.FC<DeanDashboardProps> = ({ activeMenu = 'dashboard', defaultTab }) => {
  const currentTab = defaultTab || (activeMenu === 'signature' ? 'signature' : 'dashboard');
  if (currentTab === 'signature') {
    return <DeanSignature />;
  }
  return <DeanSignQueue />;
};

export default DeanDashboard;
