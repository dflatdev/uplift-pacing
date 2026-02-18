import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
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
  getMorningCheckinByDate,
  getNightlyCheckinByDate,
  getNightlySummaries,
  initDb,
  saveMorningCheckin,
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

const getPrimaryEffortCategory = (effortJson) => {
  const effortList = JSON.parse(effortJson ?? '[]');
  if (!Array.isArray(effortList)) {
    return null;
  }
  const effortEntry = effortList.find((entry) => entry?.category);
  return effortEntry?.category ?? null;
};

const getPromptMode = () => {
  const hour = new Date().getHours();
  if (hour < 12) {
    return 'morning';
  }
  if (hour >= 17) {
    return 'night';
  }
  return 'choose';
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

const Section = ({ title, children }) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {children}
  </View>
);

const RatingRow = ({ label, value, onChange }) => (
  <View style={styles.row}>
    <Text style={styles.label}>{label}</Text>
    <View style={styles.ratingRow}>
      {[1, 2, 3, 4, 5].map((rating) => (
        <Pressable
          key={rating}
          onPress={() => onChange(rating)}
          style={[
            styles.ratingButton,
            value === rating && styles.ratingButtonActive,
          ]}
        >
          <Text
            style={[
              styles.ratingText,
              value === rating && styles.ratingTextActive,
            ]}
          >
            {rating}
          </Text>
        </Pressable>
      ))}
    </View>
  </View>
);

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
  const [sleepQuality, setSleepQuality] = useState(3);
  const [energyLevel, setEnergyLevel] = useState(3);
  const [nightlyDate, setNightlyDate] = useState(todayString());
  const [nightlyText, setNightlyText] = useState('');
  const [nightlySummary, setNightlySummary] = useState(null);
  const [history, setHistory] = useState([]);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [promptMode, setPromptMode] = useState(getPromptMode());
  const [selectedDate, setSelectedDate] = useState(todayString());
  const [selectedMorning, setSelectedMorning] = useState(null);
  const [selectedNightly, setSelectedNightly] = useState(null);
  const [selectedActivities, setSelectedActivities] = useState([]);
  const historyScrollRef = useRef(null);

  const today = useMemo(() => todayString(), []);
  const geminiKeyMissing = !process.env.EXPO_PUBLIC_GEMINI_API_KEY;
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
      const [morning, nightly, activities] = await Promise.all([
        getMorningCheckinByDate(date),
        getNightlyCheckinByDate(date),
        getActivitiesByDate(date),
      ]);
      setSelectedMorning(morning ?? null);
      setSelectedNightly(nightly ?? null);
      const normalizedActivities = Array.isArray(activities)
        ? activities.map((activity) => ({
            ...activity,
            primaryEffortCategory: getPrimaryEffortCategory(activity.effort_json),
          }))
        : [];
      setSelectedActivities(normalizedActivities);
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

  const handleOpenPrompt = () => {
    setError('');
    setStatus('');
    setPromptMode(getPromptMode());
    setNightlyDate(todayString());
    setShowPrompt(true);
  };

  const handleClosePrompt = () => {
    setShowPrompt(false);
  };

  const handleSaveMorning = async () => {
    setError('');
    setStatus('');
    try {
      await saveMorningCheckin({
        date: todayString(),
        sleepQuality,
        energyLevel,
      });
      setStatus('Morning check-in saved.');
      await loadSelectedDay(selectedDate);
    } catch (saveError) {
      setError(saveError.message);
    }
  };

  const handleGenerateNightly = async () => {
    setError('');
    setStatus('');
    setNightlySummary(null);

    if (geminiKeyMissing) {
      setError('Missing EXPO_PUBLIC_GEMINI_API_KEY in .env.');
      return;
    }

    if (!nightlyText.trim()) {
      setError('Please enter a short summary of your day.');
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(nightlyDate)) {
      setError('Nightly date must be in YYYY-MM-DD format.');
      return;
    }

    setLoadingSummary(true);
    try {
      const summary = await generateNightlySummary({
        date: nightlyDate,
        userText: nightlyText,
      });
      setNightlySummary(summary);
      await upsertNightlyCheckin({
        date: nightlyDate,
        isBackdated: nightlyDate !== today,
        summary,
      });
      setStatus('Nightly check-in saved.');
      await loadHistory();
      await loadSelectedDay(selectedDate);
    } catch (summaryError) {
      setError(summaryError.message);
    } finally {
      setLoadingSummary(false);
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
        <Text style={styles.selectedDaySectionTitle}>Morning check-in</Text>
        {selectedMorning ? (
          <>
            <Text style={styles.detailText}>
              Sleep quality: {selectedMorning.sleep_quality}
            </Text>
            <Text style={styles.detailText}>
              Energy level: {selectedMorning.energy_level}
            </Text>
          </>
        ) : (
          <Text style={styles.subtleText}>No morning check-in yet.</Text>
        )}
      </View>
      <View style={styles.selectedDaySection}>
        <Text style={styles.selectedDaySectionTitle}>Evening check-in</Text>
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
          <Text style={styles.subtleText}>No evening check-in yet.</Text>
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

  const renderMorningSection = () => (
    <Section title="Morning check-in">
      <Text style={styles.subtleText}>Today: {today}</Text>
      <RatingRow
        label="Sleep quality"
        value={sleepQuality}
        onChange={setSleepQuality}
      />
      <RatingRow
        label="Energy level"
        value={energyLevel}
        onChange={setEnergyLevel}
      />
      <Pressable style={styles.primaryButton} onPress={handleSaveMorning}>
        <Text style={styles.primaryButtonText}>Save morning check-in</Text>
      </Pressable>
      <Pressable
        style={styles.secondaryButton}
        onPress={() => setPromptMode('night')}
      >
        <Text style={styles.secondaryButtonText}>Switch to nightly check-in</Text>
      </Pressable>
    </Section>
  );

  const renderNightlySection = () => (
    <Section title="Nightly check-in">
      <Text style={styles.label}>Date (YYYY-MM-DD)</Text>
      <TextInput
        style={styles.input}
        value={nightlyDate}
        onChangeText={setNightlyDate}
        placeholder="YYYY-MM-DD"
      />
      <Text style={styles.label}>What did you do today?</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        value={nightlyText}
        onChangeText={setNightlyText}
        placeholder="Share your day in a few sentences..."
        multiline
      />
      <Pressable
        style={[
          styles.primaryButton,
          (loadingSummary || geminiKeyMissing) && styles.primaryButtonDisabled,
        ]}
        onPress={handleGenerateNightly}
        disabled={loadingSummary || geminiKeyMissing}
      >
        <Text style={styles.primaryButtonText}>
          {loadingSummary ? 'Analyzing...' : 'Generate summary'}
        </Text>
      </Pressable>
      {geminiKeyMissing ? (
        <Text style={styles.warningText}>
          Add EXPO_PUBLIC_GEMINI_API_KEY to .env to enable summaries.
        </Text>
      ) : null}
      {nightlySummary?.supportive_message ? (
        <Text style={styles.supportiveText}>
          {nightlySummary.supportive_message}
        </Text>
      ) : null}
      <Pressable
        style={styles.secondaryButton}
        onPress={() => setPromptMode('morning')}
      >
        <Text style={styles.secondaryButtonText}>Switch to morning check-in</Text>
      </Pressable>
    </Section>
  );

  const renderPromptSelector = () => (
    <View style={styles.selector}>
      <Text style={styles.selectorText}>Which check-in do you want to do?</Text>
      <Pressable
        style={styles.primaryButton}
        onPress={() => setPromptMode('morning')}
      >
        <Text style={styles.primaryButtonText}>Morning check-in</Text>
      </Pressable>
      <Pressable
        style={[styles.primaryButton, styles.secondaryButtonAlt]}
        onPress={() => setPromptMode('night')}
      >
        <Text style={styles.primaryButtonText}>Nightly check-in</Text>
      </Pressable>
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

  if (showPrompt) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.container}>
          <ExpoStatusBar style="auto" />
          <ScrollView contentContainerStyle={styles.promptContent}>
            <View style={styles.promptHeader}>
              <Pressable style={styles.backButton} onPress={handleClosePrompt}>
                <Text style={styles.backButtonText}>Back</Text>
              </Pressable>
              <Text style={styles.promptTitle}>Check-in</Text>
            </View>
            {promptMode === 'choose' ? renderPromptSelector() : null}
            {promptMode === 'morning' ? renderMorningSection() : null}
            {promptMode === 'night' ? renderNightlySection() : null}
            {status ? <Text style={styles.statusText}>{status}</Text> : null}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </ScrollView>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={[styles.container, styles.homeContainer]}>
        <ExpoStatusBar style="auto" />
        <ScrollView contentContainerStyle={styles.mainContent}>
        <BalloonHero
          height={heroHeight}
          width={width}
          balloonSource={heroAssets.balloon}
          bubbleText={heroAssets.bubbleText}
          balloonSize={balloonSize}
          bubbleSize={bubbleSize}
          onPress={handleOpenPrompt}
        />
          <View style={styles.calendarSection}>
            {renderHistoryGrid()}
            {renderSelectedDayPanel()}
          </View>
          {status ? <Text style={styles.statusText}>{status}</Text> : null}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </ScrollView>
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
    paddingBottom: 32,
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
