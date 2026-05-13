package db

import (
	"context"
	"database/sql"
	"fmt"
)

type Person struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	CreatedAt string `json:"createdAt"`
}

type FaceRegion struct {
	ID         int64    `json:"id"`
	RelPath    string   `json:"relPath"`
	PersonID   *int64   `json:"personId"`
	PersonName *string  `json:"personName,omitempty"`
	X          *float64 `json:"x"`
	Y          *float64 `json:"y"`
	W          *float64 `json:"w"`
	H          *float64 `json:"h"`
	Source     string   `json:"source"`
	Confidence *float64 `json:"confidence"`
}

// ListPeople returns all people ordered by name.
func ListPeople(ctx context.Context, db *sql.DB) ([]Person, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT id, name, created_at FROM person ORDER BY name COLLATE NOCASE`)
	if err != nil {
		return nil, fmt.Errorf("db: list people: %w", err)
	}
	defer rows.Close()
	var out []Person
	for rows.Next() {
		var p Person
		if err := rows.Scan(&p.ID, &p.Name, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// CreatePerson inserts a new person and returns it with the generated ID.
func CreatePerson(ctx context.Context, db *sql.DB, name string) (Person, error) {
	res, err := db.ExecContext(ctx,
		`INSERT INTO person (name) VALUES (?)`, name)
	if err != nil {
		return Person{}, fmt.Errorf("db: create person: %w", err)
	}
	id, _ := res.LastInsertId()
	var p Person
	err = db.QueryRowContext(ctx,
		`SELECT id, name, created_at FROM person WHERE id = ?`, id).
		Scan(&p.ID, &p.Name, &p.CreatedAt)
	if err != nil {
		return Person{}, fmt.Errorf("db: read-back person: %w", err)
	}
	return p, nil
}

// RenamePerson updates a person's name.
func RenamePerson(ctx context.Context, db *sql.DB, id int64, name string) (Person, error) {
	res, err := db.ExecContext(ctx,
		`UPDATE person SET name = ? WHERE id = ?`, name, id)
	if err != nil {
		return Person{}, fmt.Errorf("db: rename person: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return Person{}, sql.ErrNoRows
	}
	var p Person
	err = db.QueryRowContext(ctx,
		`SELECT id, name, created_at FROM person WHERE id = ?`, id).
		Scan(&p.ID, &p.Name, &p.CreatedAt)
	if err != nil {
		return Person{}, fmt.Errorf("db: read-back person: %w", err)
	}
	return p, nil
}

// DeletePerson removes a person. Face regions referencing this person get
// person_id set to NULL (via ON DELETE SET NULL).
func DeletePerson(ctx context.Context, db *sql.DB, id int64) error {
	res, err := db.ExecContext(ctx, `DELETE FROM person WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("db: delete person: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// ListFaceRegions returns face regions for a file, joined with person name.
func ListFaceRegions(ctx context.Context, db *sql.DB, relPath string) ([]FaceRegion, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT f.id, f.rel_path, f.person_id, p.name,
		       f.x, f.y, f.w, f.h, f.source, f.confidence
		FROM face_region f
		LEFT JOIN person p ON p.id = f.person_id
		WHERE f.rel_path = ?
		ORDER BY f.id`, relPath)
	if err != nil {
		return nil, fmt.Errorf("db: list face regions: %w", err)
	}
	defer rows.Close()
	var out []FaceRegion
	for rows.Next() {
		var r FaceRegion
		if err := rows.Scan(&r.ID, &r.RelPath, &r.PersonID, &r.PersonName,
			&r.X, &r.Y, &r.W, &r.H, &r.Source, &r.Confidence); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ListFaceRegionsByPerson returns all face regions assigned to a person.
func ListFaceRegionsByPerson(ctx context.Context, db *sql.DB, personID int64) ([]FaceRegion, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT f.id, f.rel_path, f.person_id, p.name,
		       f.x, f.y, f.w, f.h, f.source, f.confidence
		FROM face_region f
		LEFT JOIN person p ON p.id = f.person_id
		WHERE f.person_id = ?
		ORDER BY f.rel_path, f.id`, personID)
	if err != nil {
		return nil, fmt.Errorf("db: list face regions by person: %w", err)
	}
	defer rows.Close()
	var out []FaceRegion
	for rows.Next() {
		var r FaceRegion
		if err := rows.Scan(&r.ID, &r.RelPath, &r.PersonID, &r.PersonName,
			&r.X, &r.Y, &r.W, &r.H, &r.Source, &r.Confidence); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// CreateFaceRegion inserts a face region and returns it.
func CreateFaceRegion(ctx context.Context, db *sql.DB, r FaceRegion) (FaceRegion, error) {
	res, err := db.ExecContext(ctx, `
		INSERT INTO face_region (rel_path, person_id, x, y, w, h, source, confidence)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		r.RelPath, r.PersonID, r.X, r.Y, r.W, r.H, r.Source, r.Confidence)
	if err != nil {
		return FaceRegion{}, fmt.Errorf("db: create face region: %w", err)
	}
	id, _ := res.LastInsertId()
	return getFaceRegion(ctx, db, id)
}

// UpdateFaceRegion updates person assignment and/or bounding box.
func UpdateFaceRegion(ctx context.Context, db *sql.DB, r FaceRegion) (FaceRegion, error) {
	res, err := db.ExecContext(ctx, `
		UPDATE face_region
		SET person_id = ?, x = ?, y = ?, w = ?, h = ?, source = ?, confidence = ?
		WHERE id = ?`,
		r.PersonID, r.X, r.Y, r.W, r.H, r.Source, r.Confidence, r.ID)
	if err != nil {
		return FaceRegion{}, fmt.Errorf("db: update face region: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return FaceRegion{}, sql.ErrNoRows
	}
	return getFaceRegion(ctx, db, r.ID)
}

// DeleteFaceRegion removes a face region by ID.
func DeleteFaceRegion(ctx context.Context, db *sql.DB, id int64) error {
	res, err := db.ExecContext(ctx, `DELETE FROM face_region WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("db: delete face region: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// RenameFaceRegionPath updates rel_path on all face regions matching oldPath.
func RenameFaceRegionPath(ctx context.Context, db *sql.DB, oldPath, newPath string) error {
	_, err := db.ExecContext(ctx,
		`UPDATE face_region SET rel_path = ? WHERE rel_path = ?`, newPath, oldPath)
	if err != nil {
		return fmt.Errorf("db: rename face region path: %w", err)
	}
	return nil
}

func getFaceRegion(ctx context.Context, db *sql.DB, id int64) (FaceRegion, error) {
	var r FaceRegion
	err := db.QueryRowContext(ctx, `
		SELECT f.id, f.rel_path, f.person_id, p.name,
		       f.x, f.y, f.w, f.h, f.source, f.confidence
		FROM face_region f
		LEFT JOIN person p ON p.id = f.person_id
		WHERE f.id = ?`, id).
		Scan(&r.ID, &r.RelPath, &r.PersonID, &r.PersonName,
			&r.X, &r.Y, &r.W, &r.H, &r.Source, &r.Confidence)
	if err != nil {
		return FaceRegion{}, fmt.Errorf("db: get face region: %w", err)
	}
	return r, nil
}
