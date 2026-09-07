import React, { useState, useEffect } from 'react';

export interface MilestoneSubStep {
  id: string;
  title: string;
  description: string;
  status: 'completed' | 'active' | 'pending';
  actionLabel?: string;
  onAction?: () => void;
}

export interface PhaseGroup {
  phaseId: number;
  title: string;
  subtitle: string;
  status: 'completed' | 'active' | 'pending';
  subSteps: MilestoneSubStep[];
}

interface CoopStepperBarProps {
  phases: PhaseGroup[];
  activePhaseId: number;
}

// Utility to remove leading numbers (e.g. "1. ", "1.1 ") from titles
const cleanTitle = (text: string): string => text.replace(/^[\d.]+\s*/, '').trim();

const CoopStepperBar: React.FC<CoopStepperBarProps> = ({ phases, activePhaseId }) => {
  // State for user manually selecting/inspecting a phase (defaults to current activePhaseId)
  const [selectedPhaseId, setSelectedPhaseId] = useState<number>(activePhaseId);
  // State for expanding/collapsing the sub-stepper detail view
  const [isExpanded, setIsExpanded] = useState<boolean>(true);

  // Logic Lens Fix: Synchronize selectedPhaseId when activePhaseId prop updates from parent
  useEffect(() => {
    setSelectedPhaseId(activePhaseId);
  }, [activePhaseId]);

  const handleSelectPhase = (phaseId: number) => {
    setSelectedPhaseId(phaseId);
    setIsExpanded(true); // Automatically expand when selecting a phase
  };

  const currentSelectedPhase = phases.find((p) => p.phaseId === selectedPhaseId) || phases[0];
  const activePhase = phases.find((p) => p.phaseId === activePhaseId) || phases[0];

  // ponytail: Dynamic column layout matching step count on desktop so steps stay on one row without dangling cards or line overflows
  const subStepCount = currentSelectedPhase?.subSteps?.length || 0;
  let gridColsClass = 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4';
  let lineVisibilityClass = 'hidden sm:block';

  if (subStepCount === 5) {
    gridColsClass = 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-5';
    lineVisibilityClass = 'hidden lg:block';
  } else if (subStepCount === 3) {
    gridColsClass = 'grid-cols-1 sm:grid-cols-3';
    lineVisibilityClass = 'hidden sm:block';
  } else if (subStepCount === 2) {
    gridColsClass = 'grid-cols-1 sm:grid-cols-2';
    lineVisibilityClass = 'hidden sm:block';
  } else if (subStepCount === 4) {
    gridColsClass = 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4';
    lineVisibilityClass = 'hidden lg:block';
  }

  return (
    <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl border border-gray-200/80 dark:border-gray-800 shadow-sm space-y-8">
      {/* 1. Header */}
      <div className="pb-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/60 text-brand-blue dark:text-blue-400 text-xs font-bold tracking-wide">
              Co-op Lifecycle Timeline
            </span>
          </div>
          <h3 className="text-lg font-bold text-gray-800 dark:text-white mt-1 tracking-tight">
            ความคืบหน้าขั้นตอนปฏิบัติงานสหกิจศึกษา
          </h3>
        </div>

        {/* Global Expand / Collapse Toggle Button */}
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-700/80 bg-gray-50 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700/80 text-xs font-bold text-gray-700 dark:text-gray-200 transition-all cursor-pointer inline-flex items-center gap-1.5 shadow-xs shrink-0"
        >
          <span>{isExpanded ? 'ย่อรายละเอียด' : 'ขยายรายละเอียด'}</span>
          <svg
            className={`w-4 h-4 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* 2. True Master Stepper Bar (Horizontal Timeline Nodes) */}
      <div className="relative pt-2 pb-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 sm:gap-2 relative z-10">
          {phases.map((phase, idx) => {
            const isSelected = selectedPhaseId === phase.phaseId;
            const isCurrentActive = activePhaseId === phase.phaseId;
            const isCompleted = phase.status === 'completed';
            const isLastPhase = idx === phases.length - 1;

            // Node visual states
            let nodeBg = 'bg-white dark:bg-gray-900 border-2 border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400';

            if (isCompleted) {
              nodeBg = 'bg-emerald-500 border-2 border-emerald-500 text-white shadow-xs';
            } else if (isCurrentActive) {
              nodeBg = 'bg-brand-blue border-2 border-brand-blue text-white shadow-md shadow-blue-500/20 ring-4 ring-blue-100 dark:ring-blue-950/60';
            }

            return (
              <div key={phase.phaseId} className="relative flex flex-col sm:items-center">
                {/* ponytail: Segmented horizontal line dynamically changes color (emerald if completed) */}
                {!isLastPhase && (
                  <div
                    className={`hidden sm:block absolute top-6 left-1/2 w-full h-0.5 -z-0 transition-colors duration-500 ${
                      isCompleted ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-gray-800'
                    }`}
                  />
                )}

                <button
                  type="button"
                  onClick={() => handleSelectPhase(phase.phaseId)}
                  className={`w-full group flex sm:flex-col items-center gap-3 sm:gap-2.5 p-3 sm:p-2 rounded-xl transition-all cursor-pointer text-left sm:text-center z-10 ${
                    isSelected
                      ? 'bg-blue-50/50 dark:bg-gray-800/70 ring-2 ring-brand-blue/60 dark:ring-blue-500/60'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-800/40'
                  }`}
                >
                  {/* Stepper Circle Icon / Node (Clean Dot instead of number) */}
                  <div className="relative shrink-0">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center transition-transform group-hover:scale-105 ${nodeBg}`}
                    >
                      {isCompleted ? (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <span className="w-2.5 h-2.5 rounded-full bg-current" />
                      )}
                    </div>

                    {/* Active Pulsing Indicator */}
                    {isCurrentActive && (
                      <span className="absolute -top-1 -right-1 flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-brand-blue" />
                      </span>
                    )}
                  </div>

                  {/* Phase Title (Clean without leading numbers) */}
                  <div className="min-w-0 flex-1 sm:w-full">
                    <span className="block text-xs font-bold text-gray-800 dark:text-white truncate">
                      {cleanTitle(phase.title)}
                    </span>

                    {isCurrentActive && (
                      <div className="mt-1 flex items-center sm:justify-center">
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full text-brand-blue dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60">
                          กำลังดำเนินอยู่
                        </span>
                      </div>
                    )}
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. Nested Sub-Stepper (Horizontal Grid Layout for Selected Phase) */}
      {currentSelectedPhase && isExpanded && (
        <div className="rounded-2xl bg-gray-50/70 dark:bg-gray-800/30 border border-gray-200/80 dark:border-gray-800 p-5 sm:p-6 space-y-5">
          {/* Sub-Stepper Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-gray-200/60 dark:border-gray-800">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-brand-blue" />
                <h4 className="text-xs font-extrabold text-gray-800 dark:text-white uppercase tracking-wider">
                  ขั้นตอนย่อย: {cleanTitle(currentSelectedPhase.title)}
                </h4>
              </div>
              {currentSelectedPhase.subtitle && (
                <p className="text-xs text-gray-500 dark:text-gray-400 pl-4.5">
                  {currentSelectedPhase.subtitle}
                </p>
              )}
            </div>

            {selectedPhaseId !== activePhaseId && (
              <button
                type="button"
                onClick={() => handleSelectPhase(activePhaseId)}
                className="text-xs text-brand-blue dark:text-blue-400 font-semibold hover:underline cursor-pointer flex items-center gap-1 self-start sm:self-auto"
              >
                <span>กลับไปดูขั้นตอนปัจจุบัน ({cleanTitle(activePhase.title)})</span>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </button>
            )}
          </div>

          {/* Horizontal Sub-Stepper Grid Nodes */}
          <div className="relative pt-1 overflow-hidden">
            <div className={`grid ${gridColsClass} gap-4 relative z-10`}>
              {currentSelectedPhase.subSteps.map((step, idx) => {
                const isStepDone = step.status === 'completed';
                const isStepActive = step.status === 'active';
                const isLastStep = idx === currentSelectedPhase.subSteps.length - 1;

                let subNodeClass = 'bg-white dark:bg-gray-900 border-2 border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400';
                let cardBg = 'bg-white dark:bg-gray-900 border-gray-200/80 dark:border-gray-800/80 opacity-90';
                let statusTag = null;

                if (isStepDone) {
                  subNodeClass = 'bg-emerald-500 border-2 border-emerald-500 text-white';
                  cardBg = 'bg-white dark:bg-gray-900 border-emerald-200/60 dark:border-emerald-900/50';
                } else if (isStepActive) {
                  subNodeClass = 'bg-brand-blue border-2 border-brand-blue text-white ring-4 ring-blue-100 dark:ring-blue-950/60';
                  cardBg = 'bg-white dark:bg-gray-900 border-brand-blue shadow-xs dark:border-blue-500';
                  statusTag = (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-50 text-brand-blue dark:bg-blue-950/60 dark:text-blue-300">
                      ต้องดำเนินการ
                    </span>
                  );
                }

                return (
                  <div key={step.id || idx} className="relative flex flex-col group">
                    {/* Horizontal Connecting Line between sub-steps */}
                    {!isLastStep && (
                      <div
                        className={`${lineVisibilityClass} absolute top-3 left-1/2 w-full h-0.5 -z-0 transition-colors duration-500 ${
                          isStepDone ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-gray-700'
                        }`}
                      />
                    )}

                    {/* Node Dot & Status Badge Row */}
                    <div className="flex items-center gap-2.5 sm:flex-col sm:items-center mb-3 relative z-10">
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-transform group-hover:scale-110 ${subNodeClass}`}
                      >
                        {isStepDone ? (
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <span className="w-1.5 h-1.5 rounded-full bg-current" />
                        )}
                      </div>

                      {statusTag && <div className="sm:mt-0.5">{statusTag}</div>}
                    </div>

                    {/* Sub-step Card */}
                    <div className={`flex-1 p-4 rounded-xl border transition-all space-y-2 flex flex-col justify-between ${cardBg}`}>
                      <div className="space-y-1.5">
                        <h5 className="text-sm font-bold text-gray-800 dark:text-white leading-snug">
                          {cleanTitle(step.title)}
                        </h5>

                        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                          {step.description}
                        </p>
                      </div>

                      {step.actionLabel && step.onAction && (
                        <div className="pt-3 border-t border-gray-100 dark:border-gray-800/60 mt-2">
                          <button
                            type="button"
                            onClick={step.onAction}
                            className={`w-full py-1.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer inline-flex items-center justify-center gap-1.5 ${
                              isStepActive
                                ? 'bg-brand-blue hover:bg-blue-600 text-white shadow-xs'
                                : 'bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-gray-300'
                            }`}
                          >
                            <span>{step.actionLabel}</span>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CoopStepperBar;
