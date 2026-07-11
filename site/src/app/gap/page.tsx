import gaptable from "../../../public/data/gaptable.json";
import { GapDecomposition } from "@/components/GapDecomposition";

export default function Gap() {
  return <div><h1>Gauge Gap <span className="subtitle">where ours differs from BLS</span></h1><p className="lede">Contribution arithmetic reconciles the headline gap component by component.</p><GapDecomposition rows={gaptable.rows} asOf={gaptable.as_of} officialMonth={gaptable.official_month} totalGapPp={gaptable.total_gap_pp} /></div>;
}
