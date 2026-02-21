package server

import (
	"fmt"
	"sort"
	"sync"
	"time"
)

// Notification は通知アイテムを表す。
type Notification struct {
	Session     string `json:"session"`
	WindowIndex int    `json:"window_index"`
	Type        string `json:"type"`
}

// NotificationEvent は通知の変更イベント。
type NotificationEvent struct {
	Action        string         `json:"action"` // "set" or "clear"
	Notifications []Notification `json:"notifications"`
}

// NotificationStore は通知の in-memory ストア。
type NotificationStore struct {
	mu    sync.Mutex
	items map[string]*notificationEntry // key: "session:windowIndex"
	subs  map[chan NotificationEvent]struct{}
}

type notificationEntry struct {
	notification Notification
	timer        *time.Timer
}

// notificationTTL is the default TTL for notifications.
// Exported as a variable for testing.
var notificationTTL = 30 * time.Minute

// NewNotificationStore はNotificationStoreを生成する。
func NewNotificationStore() *NotificationStore {
	return &NotificationStore{
		items: make(map[string]*notificationEntry),
		subs:  make(map[chan NotificationEvent]struct{}),
	}
}

// Set は通知を追加/更新し、TTLタイマーを開始してサブスクライバにブロードキャストする。
func (s *NotificationStore) Set(session string, windowIndex int, ntype string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	key := fmt.Sprintf("%s:%d", session, windowIndex)

	// 既存のタイマーをキャンセル
	if entry, exists := s.items[key]; exists {
		entry.timer.Stop()
	}

	n := Notification{
		Session:     session,
		WindowIndex: windowIndex,
		Type:        ntype,
	}

	timer := time.AfterFunc(notificationTTL, func() {
		s.Clear(session, windowIndex)
	})

	s.items[key] = &notificationEntry{
		notification: n,
		timer:        timer,
	}

	s.broadcast("set")
}

// Clear は通知を削除し、タイマーを停止してサブスクライバにブロードキャストする。
func (s *NotificationStore) Clear(session string, windowIndex int) {
	s.mu.Lock()
	defer s.mu.Unlock()

	key := fmt.Sprintf("%s:%d", session, windowIndex)

	if entry, exists := s.items[key]; exists {
		entry.timer.Stop()
		delete(s.items, key)
	}

	s.broadcast("clear")
}

// List は全通知のスナップショットをキーでソートして返す。
func (s *NotificationStore) List() []Notification {
	s.mu.Lock()
	defer s.mu.Unlock()

	return s.listLocked()
}

// listLocked はロックを取得済みの状態で通知リストを返す。
func (s *NotificationStore) listLocked() []Notification {
	result := make([]Notification, 0, len(s.items))
	for _, entry := range s.items {
		result = append(result, entry.notification)
	}

	sort.Slice(result, func(i, j int) bool {
		ki := fmt.Sprintf("%s:%d", result[i].Session, result[i].WindowIndex)
		kj := fmt.Sprintf("%s:%d", result[j].Session, result[j].WindowIndex)
		return ki < kj
	})

	return result
}

// Subscribe はイベントチャネルを作成し、サブスクライバとして登録する。
func (s *NotificationStore) Subscribe() chan NotificationEvent {
	s.mu.Lock()
	defer s.mu.Unlock()

	ch := make(chan NotificationEvent, 16)
	s.subs[ch] = struct{}{}
	return ch
}

// Unsubscribe はサブスクライバを解除し、チャネルをクローズする。
func (s *NotificationStore) Unsubscribe(ch chan NotificationEvent) {
	s.mu.Lock()
	defer s.mu.Unlock()

	delete(s.subs, ch)
	close(ch)
}

// broadcast はロックを取得済みの状態で全サブスクライバにイベントを送信する。
func (s *NotificationStore) broadcast(action string) {
	event := NotificationEvent{
		Action:        action,
		Notifications: s.listLocked(),
	}

	for ch := range s.subs {
		select {
		case ch <- event:
		default:
		}
	}
}
