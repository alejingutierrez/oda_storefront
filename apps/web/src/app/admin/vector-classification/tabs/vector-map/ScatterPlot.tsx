"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { scaleLinear } from "d3-scale";
import { select } from "d3-selection";
import { zoom as d3Zoom, zoomIdentity, type ZoomBehavior } from "d3-zoom";
import { getMenuGroupColor } from "./colors";
import type { ProjectedCentroid, ViewLevel } from "./types";

type Props = {
  data: ProjectedCentroid[];
  level: ViewLevel;
  selectedIds: Set<string>;
  hoveredId: string | null;
  onHover: (id: string | null, event?: React.MouseEvent) => void;
  onSelect: (id: string, multi: boolean) => void;
  width: number;
  height: number;
};

const PADDING = 40;
const MIN_RADIUS = 6;
const MAX_RADIUS = 24;

export default function ScatterPlot({
  data,
  level,
  selectedIds,
  hoveredId,
  onHover,
  onSelect,
  width,
  height,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown>>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });

  const xScale = scaleLinear()
    .domain([0, 1])
    .range([PADDING, width - PADDING]);

  const yScale = scaleLinear()
    .domain([0, 1])
    .range([PADDING, height - PADDING]);

  const maxSamples = Math.max(1, ...data.map((d) => d.sampleCount));
  const radiusScale = scaleLinear()
    .domain([0, Math.log(maxSamples + 1)])
    .range([MIN_RADIUS, MAX_RADIUS])
    .clamp(true);

  const getRadius = useCallback(
    (sampleCount: number) => radiusScale(Math.log(sampleCount + 1)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [maxSamples],
  );

  // Initialize D3 zoom
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const zoomBehavior = d3Zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 8])
      .on("zoom", (event) => {
        const { x, y, k } = event.transform;
        setTransform({ x, y, k });
      });

    select(svg).call(zoomBehavior);
    zoomRef.current = zoomBehavior;

    return () => {
      select(svg).on(".zoom", null);
    };
  }, []);

  // Reset zoom when data or level changes
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !zoomRef.current) return;
    select(svg).call(zoomRef.current.transform, zoomIdentity);
    setTransform({ x: 0, y: 0, k: 1 });
  }, [data, level]);

  const showLabels = level === "category" || (data.length <= 30 && transform.k > 1.5);

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      className="cursor-grab active:cursor-grabbing bg-white rounded-lg border border-slate-200"
    >
      <g
        ref={gRef}
        transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}
      >
        {/* Centroid circles */}
        {data.map((d) => {
          const cx = xScale(d.x);
          const cy = yScale(d.y);
          const r = getRadius(d.sampleCount);
          const isSelected = selectedIds.has(d.id);
          const isHovered = hoveredId === d.id;
          const color = getMenuGroupColor(d.menuGroup);

          return (
            <g key={d.id}>
              {/* Selection ring */}
              {isSelected && (
                <circle
                  cx={cx}
                  cy={cy}
                  r={r + 4}
                  fill="none"
                  stroke={color}
                  strokeWidth={2.5}
                  strokeDasharray="4 2"
                  opacity={0.8}
                />
              )}

              {/* Main circle */}
              <circle
                cx={cx}
                cy={cy}
                r={r}
                fill={color}
                fillOpacity={isSelected ? 0.95 : isHovered ? 0.85 : 0.65}
                stroke={isHovered ? "#1e293b" : "white"}
                strokeWidth={isHovered ? 2 : 1}
                className="transition-opacity duration-150 cursor-pointer"
                onMouseEnter={(e) => onHover(d.id, e)}
                onMouseLeave={() => onHover(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(d.id, e.shiftKey);
                }}
              />

              {/* Label */}
              {(showLabels || isHovered || isSelected) && (
                <text
                  x={cx}
                  y={cy - r - 5}
                  textAnchor="middle"
                  fontSize={11 / transform.k}
                  fontWeight={isSelected || isHovered ? 600 : 400}
                  fill="#334155"
                  pointerEvents="none"
                >
                  {d.displayLabel.length > 20
                    ? d.displayLabel.slice(0, 18) + "…"
                    : d.displayLabel}
                </text>
              )}
            </g>
          );
        })}
      </g>

      {/* Zoom indicator */}
      {transform.k !== 1 && (
        <text
          x={width - 10}
          y={height - 10}
          textAnchor="end"
          fontSize={11}
          fill="#94a3b8"
        >
          {Math.round(transform.k * 100)}%
        </text>
      )}
    </svg>
  );
}
