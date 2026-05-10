#!/bin/bash
echo "==========================================="
echo "  Sofascore Analytics - Project Setup"
echo "==========================================="

# Check Node.js
if command -v node &> /dev/null; then
    echo "✅ Node.js $(node -v)"
else
    echo "❌ Node.js required"
    exit 1
fi

# Check MySQL
if command -v mysql &> /dev/null; then
    echo "✅ MySQL found"
else
    echo "⚠️ MySQL not found - database setup skipped"
fi

# Install backend dependencies
echo ""
echo "📦 Installing backend dependencies..."
cd backend && npm install
cd ..

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Create database: mysql -u root -e 'CREATE DATABASE sofascore_analytics'"
echo "  2. Run migrations: for f in database/schema/*.sql; do mysql -u root sofascore_analytics < \$f; done"
echo "  3. Start backend: cd backend && npm start"
echo "  4. Open frontend: cd frontend && npx serve . -p 5500"

