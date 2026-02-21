package server

import (
	"sort"
	"testing"
	"time"
)

func TestNotificationStore_SetAndList(t *testing.T) {
	store := NewNotificationStore()

	store.Set("main", 0, "bell")

	got := store.List()
	if len(got) != 1 {
		t.Fatalf("List() の件数 = %d, want 1", len(got))
	}
	if got[0].Session != "main" {
		t.Errorf("Session = %q, want %q", got[0].Session, "main")
	}
	if got[0].WindowIndex != 0 {
		t.Errorf("WindowIndex = %d, want 0", got[0].WindowIndex)
	}
	if got[0].Type != "bell" {
		t.Errorf("Type = %q, want %q", got[0].Type, "bell")
	}
}

func TestNotificationStore_Clear(t *testing.T) {
	store := NewNotificationStore()

	store.Set("main", 1, "activity")
	store.Clear("main", 1)

	got := store.List()
	if len(got) != 0 {
		t.Fatalf("Clear 後の List() の件数 = %d, want 0", len(got))
	}
}

func TestNotificationStore_ClearNonExistent(t *testing.T) {
	store := NewNotificationStore()

	// パニックしないことを確認
	store.Clear("nonexistent", 99)

	got := store.List()
	if len(got) != 0 {
		t.Fatalf("List() の件数 = %d, want 0", len(got))
	}
}

func TestNotificationStore_Subscribe(t *testing.T) {
	store := NewNotificationStore()
	ch := store.Subscribe()
	defer store.Unsubscribe(ch)

	store.Set("dev", 2, "bell")

	select {
	case event := <-ch:
		if event.Action != "set" {
			t.Errorf("Action = %q, want %q", event.Action, "set")
		}
		if len(event.Notifications) != 1 {
			t.Fatalf("Notifications の件数 = %d, want 1", len(event.Notifications))
		}
		if event.Notifications[0].Session != "dev" {
			t.Errorf("Session = %q, want %q", event.Notifications[0].Session, "dev")
		}
	case <-time.After(time.Second):
		t.Fatal("Subscribe 後に Set したがイベントを受信できなかった")
	}
}

func TestNotificationStore_Unsubscribe(t *testing.T) {
	store := NewNotificationStore()
	ch := store.Subscribe()
	store.Unsubscribe(ch)

	store.Set("dev", 0, "bell")

	// Unsubscribe 後はチャネルがクローズされているので、受信してもゼロ値が返る
	select {
	case _, ok := <-ch:
		if ok {
			t.Fatal("Unsubscribe 後にイベントを受信した")
		}
		// ok == false はチャネルがクローズされたことを意味する（期待通り）
	case <-time.After(100 * time.Millisecond):
		t.Fatal("Unsubscribe 後にチャネルがクローズされていない")
	}
}

func TestNotificationStore_TTLExpiry(t *testing.T) {
	// TTL を短くしてテスト
	origTTL := notificationTTL
	notificationTTL = 50 * time.Millisecond
	defer func() { notificationTTL = origTTL }()

	store := NewNotificationStore()
	ch := store.Subscribe()
	defer store.Unsubscribe(ch)

	store.Set("main", 0, "bell")

	// 最初の set イベントを消費
	select {
	case <-ch:
	case <-time.After(time.Second):
		t.Fatal("set イベントを受信できなかった")
	}

	// TTL 期限切れで clear イベントが届くのを待つ
	select {
	case event := <-ch:
		if event.Action != "clear" {
			t.Errorf("TTL 期限切れ後の Action = %q, want %q", event.Action, "clear")
		}
		if len(event.Notifications) != 0 {
			t.Errorf("TTL 期限切れ後の Notifications の件数 = %d, want 0", len(event.Notifications))
		}
	case <-time.After(time.Second):
		t.Fatal("TTL 期限切れの clear イベントを受信できなかった")
	}

	// List でも消えていることを確認
	got := store.List()
	if len(got) != 0 {
		t.Fatalf("TTL 期限切れ後の List() の件数 = %d, want 0", len(got))
	}
}

func TestNotificationStore_SetOverwrite(t *testing.T) {
	store := NewNotificationStore()

	store.Set("main", 0, "bell")
	store.Set("main", 0, "activity")

	got := store.List()
	if len(got) != 1 {
		t.Fatalf("同一キーを2回 Set した後の List() の件数 = %d, want 1", len(got))
	}
	if got[0].Type != "activity" {
		t.Errorf("Type = %q, want %q (上書き後)", got[0].Type, "activity")
	}
}

func TestNotificationStore_ListOrder(t *testing.T) {
	store := NewNotificationStore()

	// 複数のキーを追加
	store.Set("b-session", 1, "bell")
	store.Set("a-session", 0, "activity")
	store.Set("a-session", 2, "bell")

	got := store.List()
	if len(got) != 3 {
		t.Fatalf("List() の件数 = %d, want 3", len(got))
	}

	// ソートされていることを確認
	isSorted := sort.SliceIsSorted(got, func(i, j int) bool {
		ki := got[i].Session
		kj := got[j].Session
		if ki != kj {
			return ki < kj
		}
		return got[i].WindowIndex < got[j].WindowIndex
	})
	if !isSorted {
		t.Errorf("List() がソートされていない: %+v", got)
	}
}
