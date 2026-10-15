import React, { useEffect } from 'react';
import { ChevronLeft, ChevronRight, Layers, Sparkles } from 'lucide-react';

export type VariantType = 'A' | 'B' | 'C';

interface PrototypeSwitcherProps {
  currentVariant: VariantType;
  onVariantChange: (variant: VariantType) => void;
}

const VARIANTS: { id: VariantType; label: string; desc: string }[] = [
  { id: 'A', label: 'Proposta A: Compact Minimalist', desc: 'Largura 288px, ponto de status no avatar, ultra limpo' },
  { id: 'B', label: 'Proposta B: Badges & Filtros', desc: 'Largura 320px, abas de filtro rápido e chips de status' },
  { id: 'C', label: 'Proposta C: Slim Lateral & Switch', desc: 'Largura 304px, listra lateral colorida e ícone de rádio' }
];

export const PrototypeSwitcher: React.FC<PrototypeSwitcherProps> = ({
  currentVariant,
  onVariantChange
}) => {
  const currentIndex = VARIANTS.findIndex((v) => v.id === currentVariant);

  const handlePrev = () => {
    const nextIndex = (currentIndex - 1 + VARIANTS.length) % VARIANTS.length;
    onVariantChange(VARIANTS[nextIndex].id);
  };

  const handleNext = () => {
    const nextIndex = (currentIndex + 1) % VARIANTS.length;
    onVariantChange(VARIANTS[nextIndex].id);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Não intercepta se o usuário estiver digitando em campo de texto
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex]);

  const current = VARIANTS[currentIndex] || VARIANTS[0];

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-1 pointer-events-auto select-none">
      <div className="flex items-center gap-2 bg-gray-900/95 backdrop-blur-md border border-emerald-500/40 text-gray-200 px-3 py-2 rounded-full shadow-2xl ring-1 ring-black/50">
        <div className="flex items-center gap-1.5 pl-1 pr-2 border-r border-gray-700/80 text-emerald-400 font-semibold text-xs">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Propostas de Layout:</span>
        </div>

        {/* Botão Anterior */}
        <button
          type="button"
          onClick={handlePrev}
          title="Proposta anterior (ou seta esquerda no teclado)"
          className="p-1 rounded-full hover:bg-gray-800 text-gray-400 hover:text-white transition"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {/* Abas das 3 Propostas */}
        <div className="flex items-center gap-1">
          {VARIANTS.map((v) => {
            const isActive = v.id === currentVariant;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => onVariantChange(v.id)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition ${
                  isActive
                    ? 'bg-emerald-500 text-gray-950 font-bold shadow-md'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`}
              >
                Opção {v.id}
              </button>
            );
          })}
        </div>

        {/* Botão Próximo */}
        <button
          type="button"
          onClick={handleNext}
          title="Próxima proposta (ou seta direita no teclado)"
          className="p-1 rounded-full hover:bg-gray-800 text-gray-400 hover:text-white transition"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Descrição da Proposta Atual */}
      <div className="text-[11px] text-gray-400 bg-gray-950/80 px-2.5 py-0.5 rounded-full border border-gray-800/80 shadow">
        <strong className="text-emerald-300">{current.label}:</strong> {current.desc}
      </div>
    </div>
  );
};
