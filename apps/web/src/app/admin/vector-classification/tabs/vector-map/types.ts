export type { ProjectedCentroid, DistanceEntry, MergeType } from "@/lib/vector-classification/types";

export type ViewLevel = "category" | "subcategory";

export type SampleProduct = {
  id: string;
  name: string;
  imageCoverUrl: string | null;
  brandName: string | null;
};
