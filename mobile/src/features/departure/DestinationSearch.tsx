import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { searchPlaces, type Place, type SearchError } from '@/core/geocode';
import { color, register, space, type } from '@/design/tokens';

export type DestinationSearchProps = {
  near: { lat: number; lng: number } | null;
  onPick: (place: Place) => void;
};

type SearchFlowState = 'idle' | 'searching';

/** A failed searchPlaces call is otherwise invisible — same inline-error treatment
 * the rest of Departure uses, just mapped from geocode.ts's error union. */
function searchErrorText(error: SearchError): string {
  switch (error) {
    case 'unavailable':
    case 'upstream-failed':
      return 'Search unavailable.';
    case 'network':
      return "Couldn't reach the search service.";
    case 'bad-query':
      return "Couldn't search for that.";
  }
}

/**
 * Pure search widget: query in, `onPick` out. Submit-only, deliberately no
 * search-as-you-type (ADR-013 §5 — autocomplete's extra geocode calls would share
 * the same 40/minute bucket the planner's own route previews need).
 *
 * Everything this used to own directly — the ride store, GPS, setDestination, and
 * the resulting route error — moved to the caller (app/plan/[code].tsx) with
 * ADR-013: a planner screen now owns the whole destination flow, and a reusable
 * search box has no business reaching into a store.
 */
export default function DestinationSearch({ near, onPick }: DestinationSearchProps) {
  const [query, setQuery] = useState('');
  const [searchState, setSearchState] = useState<SearchFlowState>('idle');
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  async function handleSearch() {
    setSearchError(null);
    setPlaces(null);
    const text = query.trim();
    if (!text) return; // nothing typed — silent no-op, not an error
    if (!near) {
      setSearchError('Need your location to plan a route.');
      return;
    }
    setSearchState('searching');
    const result = await searchPlaces(text, near);
    setSearchState('idle');
    if (!result.ok) {
      setSearchError(searchErrorText(result.error));
      return;
    }
    setPlaces(result.places);
  }

  function handlePick(place: Place) {
    setQuery('');
    setPlaces(null);
    setSearchError(null);
    onPick(place);
  }

  return (
    <View>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search for a destination"
        placeholderTextColor={color.ink.tertiary}
        returnKeyType="search"
        onSubmitEditing={handleSearch}
        style={[
          type.departure.body,
          {
            color: color.ink.primary,
            minHeight: register.departure.touchTarget,
            borderBottomWidth: 1,
            borderColor: color.surface.hairline,
            marginTop: space[2],
          },
        ]}
      />
      {searchState === 'searching' && (
        <Text style={[type.departure.body, { color: color.ink.secondary, marginTop: space[2] }]}>
          Searching…
        </Text>
      )}
      {places?.length === 0 && (
        <Text style={[type.departure.body, { color: color.ink.secondary, marginTop: space[2] }]}>
          No results.
        </Text>
      )}
      {places?.map((place, i) => (
        <Pressable
          key={`${place.lat},${place.lng},${i}`}
          onPress={() => handlePick(place)}
          style={{ minHeight: register.departure.touchTarget, justifyContent: 'center' }}
        >
          <Text style={[type.departure.body, { color: color.ink.primary }]}>{place.label}</Text>
        </Pressable>
      ))}
      {searchError && (
        <Text style={[type.departure.body, { color: color.ink.primary, marginTop: space[2] }]}>
          {searchError}
        </Text>
      )}
    </View>
  );
}
