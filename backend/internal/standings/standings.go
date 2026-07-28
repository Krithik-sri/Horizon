package standings

import "math"

// Pt is a geographic point. Note: lat/lng order (the internal convention).
// MapLibre/GeoJSON use [lng, lat] — convert at the client boundary, not here.
type Pt struct {
	Lat float64
	Lng float64
}

const earthRadiusM = 6371000.0

// Haversine returns the great-circle distance between a and b in metres.
func Haversine(a, b Pt) float64 {
	la1 := a.Lat * math.Pi / 180
	la2 := b.Lat * math.Pi / 180
	dLat := (b.Lat - a.Lat) * math.Pi / 180
	dLng := (b.Lng - a.Lng) * math.Pi / 180
	h := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(la1)*math.Cos(la2)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * earthRadiusM * math.Asin(math.Min(1, math.Sqrt(h)))
}

// projectOntoSegment projects p onto segment a→b using a local planar approximation
// (good enough at city scale). Returns the projected point and t in [0,1] along the segment.
func projectOntoSegment(a, b, p Pt) (Pt, float64) {
	latRef := a.Lat * math.Pi / 180
	mPerDegLat := 111320.0
	mPerDegLng := 111320.0 * math.Cos(latRef)

	bx := (b.Lng - a.Lng) * mPerDegLng
	by := (b.Lat - a.Lat) * mPerDegLat
	px := (p.Lng - a.Lng) * mPerDegLng
	py := (p.Lat - a.Lat) * mPerDegLat

	seg2 := bx*bx + by*by
	t := 0.0
	if seg2 > 0 {
		t = (px*bx + py*by) / seg2
		t = math.Max(0, math.Min(1, t))
	}
	proj := Pt{Lat: a.Lat + (b.Lat-a.Lat)*t, Lng: a.Lng + (b.Lng-a.Lng)*t}
	return proj, t
}

// DistAlongRoute returns metres travelled along route for point p:
// the distance to the projection on the nearest segment. (docs/SYSTEM_DESIGN.md §7.)
//
// Refinement for Phase 2: pass the rider's previous distAlong and constrain the segment
// search to a window around it, so progress stays monotonic on out-and-back / looped routes
// where naive nearest-segment can snap to the wrong place.
func DistAlongRoute(route []Pt, p Pt) float64 {
	var cum, best float64
	bestDist := math.Inf(1)
	for i := 0; i+1 < len(route); i++ {
		a, b := route[i], route[i+1]
		proj, t := projectOntoSegment(a, b, p)
		if d := Haversine(p, proj); d < bestDist {
			bestDist = d
			best = cum + t*Haversine(a, b)
		}
		cum += Haversine(a, b)
	}
	return best
}
