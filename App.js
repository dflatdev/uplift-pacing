import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  getActivitiesByDate,
  getCheckinsByDate,
  getNightlyCheckinByDate,
  getNightlySummaries,
  initDb,
  saveCheckinEntry,
  upsertNightlyCheckin,
} from './src/db';
import { generateNightlySummary } from './src/gemini';

const todayString = () => new Date().toISOString().slice(0, 10);
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ACTIVITY_ICON_MAP = {
  physical: 'run',
  cognitive: 'brain',
  social: 'account-group',
  sensory: 'eye-outline',
  emotional: 'heart-outline',
};
const DEFAULT_ACTIVITY_ICON = 'calendar-check';

const getActivityIconName = (category) =>
  ACTIVITY_ICON_MAP[category] ?? DEFAULT_ACTIVITY_ICON;

const formatTime = (timestamp) =>
  new Date(timestamp).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });

const formatRelativeDays = (dateString, timestamp) => {
  const baseDate = new Date(dateString);
  const createdDate = new Date(timestamp);
  baseDate.setHours(0, 0, 0, 0);
  createdDate.setHours(0, 0, 0, 0);
  const diffDays = Math.max(
    0,
    Math.round((createdDate - baseDate) / (24 * 60 * 60 * 1000))
  );
  if (diffDays === 0) {
    return 'Same day';
  }
  if (diffDays === 1) {
    return '1 day later';
  }
  return `${diffDays} days later`;
};

const getPrimaryEffortCategory = (effortJson) => {
  const effortList = JSON.parse(effortJson ?? '[]');
  if (!Array.isArray(effortList)) {
    return null;
  }
  const effortEntry = effortList.find((entry) => entry?.category);
  return effortEntry?.category ?? null;
};

const getHeroAssets = () => {
  const hour = new Date().getHours();
  if (hour < 12) {
    return {
      balloon: require('./assets-src/air_balloon_close_morning.png'),
      bubbleText: 'Ready for adventure?',
    };
  }
  if (hour >= 17) {
    return {
      balloon: require('./assets-src/air_balloon_close_night.png'),
      bubbleText: 'Time for check-in',
    };
  }
  return {
    balloon: require('./assets-src/air_balloon_day.png'),
    bubbleText: 'Time for check-in',
  };
};

const BalloonHero = ({
  height,
  width,
  balloonSource,
  bubbleText,
  balloonSize,
  bubbleSize,
  onPress,
}) => {
  const bubbleLayout = bubbleSize
    ? { maxWidth: bubbleSize.width, minHeight: bubbleSize.height }
    : null;
  return (
    <Pressable style={[styles.hero, { height, width }]} onPress={onPress}>
      <Image
        source={balloonSource}
        style={[styles.balloonImage, balloonSize]}
        resizeMode="contain"
      />
      {bubbleText ? (
        <View style={[styles.bubbleContainer, bubbleLayout]}>
          <Text style={styles.bubbleText}>{bubbleText}</Text>
          <View style={styles.bubbleTail} />
        </View>
      ) : null}
    </Pressable>
  );
};

export default function App() {
  const { width } = useWindowDimensions();
  const gridColumns = 5;
  const gridGap = 8;
  const gridPadding = 20;
  const todayScale = 1.3;
  const availableGridWidth =
    width - gridPadding * 2 - gridGap * (gridColumns - 1);
  const daySize = Math.floor(availableGridWidth / (gridColumns - 1 + todayScale));
  const todaySize = Math.floor(daySize * todayScale);

  const [dbReady, setDbReady] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [checkinText, setCheckinText] = useState('');
  const [submittingCheckin, setSubmittingCheckin] = useState(false);
  const [history, setHistory] = useState([]);
  const [selectedDate, setSelectedDate] = useState(todayString());
  const [selectedNightly, setSelectedNightly] = useState(null);
  const [selectedActivities, setSelectedActivities] = useState([]);
  const [selectedCheckins, setSelectedCheckins] = useState([]);
  const historyScrollRef = useRef(null);

  const today = useMemo(() => todayString(), []);
  const geminiKeyMissing = !process.env.EXPO_PUBLIC_GEMINI_API_KEY;
  const isSubmitDisabled =
    submittingCheckin || geminiKeyMissing || !checkinText.trim();
  const isBackdatedView = selectedDate !== today;
  const heroAssets = getHeroAssets();
  const balloonAsset = Image.resolveAssetSource(heroAssets.balloon);
  const balloonAspectRatio =
    balloonAsset?.width && balloonAsset?.height
      ? balloonAsset.width / balloonAsset.height
      : 1;
  const heroHeight = Math.floor(width / balloonAspectRatio);
  const balloonSize = {
    width,
    height: heroHeight,
  };
  const bubbleSize = {
    width: Math.min(220, Math.floor(width * 0.5)),
    height: Math.floor(heroHeight * 0.25),
  };

  const historyByDate = useMemo(() => {
    const map = {};
    history.forEach((entry) => {
      map[entry.date] = entry.overall;
    });
    return map;
  }, [history]);

  const historyDays = useMemo(() => {
    const days = [];
    for (let i = 9; i >= 0; i -= 1) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateString = date.toISOString().slice(0, 10);
      days.push({
        date: dateString,
        dayLabel: WEEKDAY_LABELS[date.getDay()],
        isToday: i === 0,
        overall: historyByDate[dateString] ?? 'none',
      });
    }
    return days;
  }, [historyByDate]);

  const selectedDayLabel = useMemo(() => {
    const selectedEntry = historyDays.find((day) => day.date === selectedDate);
    if (selectedEntry?.isToday) {
      return 'Today';
    }
    return selectedEntry?.dayLabel ?? selectedDate;
  }, [historyDays, selectedDate]);

  const loadHistory = async () => {
    const summaries = await getNightlySummaries();
    setHistory(summaries);
  };

  const loadSelectedDay = async (date) => {
    try {
      const [nightly, activities, checkins] = await Promise.all([
        getNightlyCheckinByDate(date),
        getActivitiesByDate(date),
        getCheckinsByDate(date),
      ]);
      setSelectedNightly(nightly ?? null);
      const normalizedActivities = Array.isArray(activities)
        ? activities.map((activity) => ({
            ...activity,
            primaryEffortCategory: getPrimaryEffortCategory(activity.effort_json),
          }))
        : [];
      setSelectedActivities(normalizedActivities);
      setSelectedCheckins(Array.isArray(checkins) ? checkins : []);
    } catch (loadError) {
      setError(loadError.message);
    }
  };

  useEffect(() => {
    let isMounted = true;
    initDb()
      .then(() => {
        if (!isMounted) {
          return;
        }
        setDbReady(true);
        return loadHistory();
      })
      .catch((initError) => {
        if (isMounted) {
          setError(initError.message);
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!dbReady) {
      return;
    }
    loadSelectedDay(selectedDate);
  }, [dbReady, selectedDate]);

  const handleSubmitCheckin = async () => {
    setError('');
    setStatus('');

    if (geminiKeyMissing) {
      setError('Missing EXPO_PUBLIC_GEMINI_API_KEY in .env.');
      return;
    }

    const trimmedText = checkinText.trim();
    if (!trimmedText) {
      setError('');
      return;
    }

    setSubmittingCheckin(true);
    try {
      const summary = await generateNightlySummary({
        date: selectedDate,
        userText: trimmedText,
      });
      await upsertNightlyCheckin({
        date: selectedDate,
        isBackdated: selectedDate !== today,
        summary,
        mergeActivities: true,
      });
      await saveCheckinEntry({
        date: selectedDate,
        userText: trimmedText,
        summary,
      });
      setCheckinText('');
      setStatus('Check-in saved.');
      await loadHistory();
      await loadSelectedDay(selectedDate);
    } catch (summaryError) {
      setError(summaryError.message);
    } finally {
      setSubmittingCheckin(false);
    }
  };

  const renderHistoryGrid = () => (
    <ScrollView
      horizontal
      ref={historyScrollRef}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.historyGrid}
      onContentSizeChange={() =>
        historyScrollRef.current?.scrollToEnd({ animated: false })
      }
    >
      {historyDays.map((day) => {
        const cellSize = day.isToday ? todaySize : daySize;
        const isSelected = day.date === selectedDate;
        const backgroundColor =
          day.overall === 'green'
            ? '#6fcb8f'
            : day.overall === 'yellow'
            ? '#f3c15b'
            : day.overall === 'red'
            ? '#e26d67'
            : '#e6e6e6';
        return (
          <Pressable
            key={day.date}
            onPress={() => setSelectedDate(day.date)}
            style={styles.historyItem}
          >
            <Text
              style={[styles.dayLabel, day.isToday && styles.dayLabelToday]}
            >
              {day.isToday ? 'Today' : day.dayLabel}
            </Text>
            <View
              style={[
                styles.dayCell,
                isSelected && styles.dayCellSelected,
                { width: cellSize, height: cellSize, backgroundColor },
              ]}
            />
          </Pressable>
        );
      })}
    </ScrollView>
  );

  const renderSelectedDayPanel = () => (
    <View style={styles.selectedDayPanel}>
      <Text style={styles.selectedDayTitle}>{selectedDayLabel}</Text>
      <View style={styles.selectedDaySection}>
        <Text style={styles.selectedDaySectionTitle}>Day summary</Text>
        {selectedNightly ? (
          <>
            {selectedNightly.energy_assessment ? (
              <Text style={styles.detailText}>
                Energy balance: {selectedNightly.energy_assessment}
              </Text>
            ) : null}
            {selectedNightly.energy_current_state ? (
              <Text style={styles.detailText}>
                Current state: {selectedNightly.energy_current_state}
              </Text>
            ) : null}
            {selectedNightly.crash_occurred ? (
              <Text style={styles.detailText}>
                Crash: {selectedNightly.crash_severity ?? 'noted'}
              </Text>
            ) : null}
            {selectedNightly.supportive_message ? (
              <Text style={styles.supportiveText}>
                {selectedNightly.supportive_message}
              </Text>
            ) : null}
          </>
        ) : (
          <Text style={styles.subtleText}>No summary yet.</Text>
        )}
      </View>
      <View style={styles.selectedDaySection}>
        <Text style={styles.selectedDaySectionTitle}>Check-ins</Text>
        {selectedCheckins.length ? (
          selectedCheckins.map((checkin) => (
            <View key={checkin.id} style={styles.checkinItem}>
              <Text style={styles.checkinTime}>
                {isBackdatedView
                  ? formatRelativeDays(selectedDate, checkin.created_at)
                  : formatTime(checkin.created_at)}
              </Text>
              <Text style={styles.checkinText}>{checkin.user_text}</Text>
            </View>
          ))
        ) : (
          <Text style={styles.subtleText}>No check-ins yet.</Text>
        )}
      </View>
      <View style={styles.selectedDaySection}>
        <Text style={styles.selectedDaySectionTitle}>Activities</Text>
        {selectedActivities.length ? (
          selectedActivities.map((activity) => (
            <View key={activity.id} style={styles.activityItem}>
              <View style={styles.activityHeader}>
                <MaterialCommunityIcons
                  name={getActivityIconName(activity.primaryEffortCategory)}
                  size={18}
                  style={styles.activityIcon}
                />
                <Text style={styles.activityName}>{activity.name}</Text>
              </View>
              {activity.duration_minutes ? (
                <Text style={styles.activityMeta}>
                  Duration: {activity.duration_minutes} min
                </Text>
              ) : null}
              {activity.difficulty_noted ? (
                <Text style={styles.activityMeta}>Noted difficulty</Text>
              ) : null}
              {activity.notes ? (
                <Text style={styles.activityMeta}>{activity.notes}</Text>
              ) : null}
            </View>
          ))
        ) : (
          <Text style={styles.subtleText}>No activities logged.</Text>
        )}
      </View>
    </View>
  );

  if (!dbReady) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.container}>
          <ExpoStatusBar style="auto" />
          <View style={styles.loading}>
            <ActivityIndicator size="large" />
            <Text style={styles.loadingText}>Preparing Uplift...</Text>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.container, styles.homeContainer]}>
        <ExpoStatusBar style="auto" />
        <ScrollView
          style={styles.mainScroll}
          contentContainerStyle={styles.mainContent}
        >
          <BalloonHero
            height={heroHeight}
            width={width}
            balloonSource={heroAssets.balloon}
            bubbleText={heroAssets.bubbleText}
            balloonSize={balloonSize}
            bubbleSize={bubbleSize}
          />
          <View style={styles.calendarSection}>
            {renderHistoryGrid()}
            {renderSelectedDayPanel()}
          </View>
          {status ? <Text style={styles.statusText}>{status}</Text> : null}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </ScrollView>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : StatusBar.currentHeight ?? 0}
        >
          <View style={styles.bottomBar}>
            <Text style={styles.bottomBarLabel}>
              Check in for {selectedDayLabel}
            </Text>
            <View style={styles.bottomBarRow}>
            <TextInput
              style={styles.bottomBarInput}
              value={checkinText}
              onChangeText={setCheckinText}
              placeholder="Add a quick check-in..."
              multiline
            />
              <Pressable
                style={[
                  styles.bottomBarButton,
                  isSubmitDisabled && styles.bottomBarButtonDisabled,
                ]}
                onPress={handleSubmitCheckin}
                disabled={isSubmitDisabled}
              >
                <Text style={styles.bottomBarButtonText}>
                  {submittingCheckin ? 'Saving' : 'Send'}
                </Text>
              </Pressable>
            </View>
            {geminiKeyMissing ? (
              <Text style={styles.warningText}>
                Add EXPO_PUBLIC_GEMINI_API_KEY to .env to enable summaries.
              </Text>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f2ed',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0,
  },
  homeContainer: {
    backgroundColor: '#e6f1ff',
  },
  mainContent: {
    paddingHorizontal: 20,
    paddingBottom: 160,
  },
  mainScroll: {
    flex: 1,
  },
  hero: {
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: -20,
    marginBottom: 16,
    width: '100%',
  },
  balloonImage: {
    marginTop: 8,
  },
  bubbleContainer: {
    position: 'absolute',
    right: 12,
    bottom: 60,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
    overflow: 'visible',
  },
  bubbleText: {
    color: '#2b2b2b',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  bubbleTail: {
    position: 'absolute',
    bottom: -10,
    right: 24,
    width: 0,
    height: 0,
    borderTopWidth: 10,
    borderTopColor: '#ffffff',
    borderLeftWidth: 8,
    borderLeftColor: 'transparent',
    borderRightWidth: 8,
    borderRightColor: 'transparent',
  },
  heroHint: {
    marginTop: 10,
    color: '#3c4b5f',
    fontWeight: '500',
  },
  calendarSection: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  calendarTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    color: '#2b2b2b',
  },
  historyGrid: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'flex-end',
    flexGrow: 1,
    justifyContent: 'flex-end',
    gap: 8,
  },
  historyItem: {
    alignItems: 'center',
  },
  dayCell: {
    borderRadius: 10,
  },
  dayCellSelected: {
    borderWidth: 2,
    borderColor: '#1f2a3a',
  },
  dayLabel: {
    color: '#2f2f2f',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  dayLabelToday: {
    color: '#1f2a3a',
    fontWeight: '700',
  },
  selectedDayPanel: {
    marginTop: 12,
    backgroundColor: '#f7f8fb',
    borderRadius: 16,
    padding: 12,
  },
  selectedDayTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2b2b2b',
    marginBottom: 10,
  },
  selectedDaySection: {
    marginBottom: 12,
  },
  checkinItem: {
    marginBottom: 8,
  },
  checkinTime: {
    color: '#4a4a4a',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 2,
  },
  checkinText: {
    color: '#4a4a4a',
  },
  selectedDaySectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2b2b2b',
    marginBottom: 6,
  },
  detailText: {
    color: '#4a4a4a',
    marginBottom: 4,
  },
  activityItem: {
    marginBottom: 8,
  },
  activityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  activityIcon: {
    color: '#5b6b7f',
  },
  activityName: {
    color: '#2b2b2b',
    fontWeight: '600',
  },
  activityMeta: {
    color: '#6b6b6b',
    fontSize: 12,
    marginTop: 2,
  },
  section: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
    color: '#2b2b2b',
  },
  row: {
    marginBottom: 12,
  },
  label: {
    fontSize: 14,
    color: '#4a4a4a',
    marginBottom: 6,
  },
  ratingRow: {
    flexDirection: 'row',
    gap: 8,
  },
  ratingButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d0d0d0',
    backgroundColor: '#f7f7f7',
  },
  ratingButtonActive: {
    borderColor: '#6c8bf0',
    backgroundColor: '#e8edff',
  },
  ratingText: {
    color: '#4a4a4a',
    fontWeight: '500',
  },
  ratingTextActive: {
    color: '#2a43b8',
  },
  input: {
    borderWidth: 1,
    borderColor: '#d0d0d0',
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
    backgroundColor: '#fafafa',
  },
  textArea: {
    minHeight: 90,
    textAlignVertical: 'top',
  },
  primaryButton: {
    backgroundColor: '#6c8bf0',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  primaryButtonDisabled: {
    backgroundColor: '#b8c4f5',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '600',
  },
  secondaryButton: {
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#f0f4ff',
  },
  secondaryButtonAlt: {
    backgroundColor: '#5b7df7',
  },
  secondaryButtonText: {
    color: '#3653b2',
    fontWeight: '600',
  },
  subtleText: {
    color: '#6b6b6b',
    marginBottom: 10,
  },
  supportiveText: {
    marginTop: 12,
    color: '#356073',
    fontStyle: 'italic',
  },
  warningText: {
    marginTop: 10,
    color: '#b36b00',
  },
  bottomBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: '#e2e6f2',
    backgroundColor: '#ffffff',
  },
  bottomBarLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2b2b2b',
    marginBottom: 8,
  },
  bottomBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bottomBarInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d0d0d0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fafafa',
    minHeight: 48,
    textAlignVertical: 'top',
  },
  bottomBarButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#6c8bf0',
  },
  bottomBarButtonDisabled: {
    backgroundColor: '#b8c4f5',
  },
  bottomBarButtonText: {
    color: '#ffffff',
    fontWeight: '600',
  },
  statusText: {
    color: '#2f6f4f',
    marginTop: 8,
  },
  errorText: {
    color: '#b00020',
    marginTop: 8,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 10,
    color: '#6b6b6b',
  },
  promptContent: {
    padding: 20,
    paddingBottom: 32,
  },
  promptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  backButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#f0f4ff',
  },
  backButtonText: {
    color: '#3653b2',
    fontWeight: '600',
  },
  promptTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#2b2b2b',
  },
  selector: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
    gap: 10,
  },
  selectorText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2b2b2b',
  },
});
