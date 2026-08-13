import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { updateRide } from '@/core/rides';
import { color, radius, register, space, type } from '@/design/tokens';

type JournalNoteProps = {
  rideId: string;
  note: string | null;
};

/**
 * The ride journal — the one place the Reflective serif voice is editable, not just
 * displayed (horizon-design: "Reflective Voice — serif. Return only."). Tap to open a
 * plain multiline TextInput, saved via core/rides.ts's updateRide on "Done".
 */
export default function JournalNote({ rideId, note }: JournalNoteProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(note ?? '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  async function handleSave() {
    setSaving(true);
    setSaveError(false);
    const trimmed = value.trim();
    const ok = await updateRide(rideId, { note: trimmed.length > 0 ? trimmed : null });
    setSaving(false);
    if (ok) {
      setValue(trimmed);
      setEditing(false);
    } else {
      setSaveError(true);
    }
  }

  if (!editing) {
    return (
      <Pressable
        onPress={() => setEditing(true)}
        style={{ minHeight: register.return.touchTarget, justifyContent: 'center' }}
      >
        <Text style={[type.reflective.body, { color: value ? color.ink.primary : color.ink.tertiary }]}>
          {value || 'Add a note about this ride…'}
        </Text>
      </Pressable>
    );
  }

  return (
    <View>
      <TextInput
        value={value}
        onChangeText={setValue}
        multiline
        autoFocus
        placeholder="Write something about this ride…"
        placeholderTextColor={color.ink.tertiary}
        style={[
          type.reflective.body,
          {
            color: color.ink.primary,
            minHeight: 96,
            textAlignVertical: 'top',
            borderWidth: 1,
            borderColor: color.surface.hairline,
            borderRadius: radius.card,
            padding: space[3],
          },
        ]}
      />
      {saveError && (
        <Text style={[type.departure.label, { color: color.ink.primary, marginTop: space[2] }]}>
          Couldn't save — try again.
        </Text>
      )}
      <Pressable
        onPress={handleSave}
        disabled={saving}
        style={{
          marginTop: space[3],
          minHeight: register.return.touchTarget,
          justifyContent: 'center',
          alignSelf: 'flex-start',
        }}
      >
        <Text style={[type.departure.body, { color: color.amber.core }]}>{saving ? 'Saving…' : 'Done'}</Text>
      </Pressable>
    </View>
  );
}
