"""Search and lookup operations.

External API integrations for search functionality (Wikipedia, etc.)
"""

import aiohttp
from typing import Optional
from loguru import logger


async def search_wikipedia(query: str, limit: int = 5) -> list[dict]:
    """Search Wikipedia API for articles.
    
    Uses the Wikipedia REST API to search for articles matching the query.
    Falls back to full-text search if OpenSearch returns no results.
    
    Args:
        query: Search query
        limit: Maximum number of results (default: 5)
        
    Returns:
        List of dicts with keys: title, snippet, url
    """
    try:
        api_url = "https://en.wikipedia.org/w/api.php"
        
        # Wikipedia requires a User-Agent header
        headers = {
            'User-Agent': 'NiaBot/1.0 (https://niaxp.com; contact@niaxp.com) aiohttp/3.0'
        }
        
        # Try OpenSearch first (fast, good for exact matches)
        params = {
            'action': 'opensearch',
            'search': query,
            'limit': limit,
            'format': 'json'
        }
        
        async with aiohttp.ClientSession(headers=headers) as session:
            async with session.get(api_url, params=params) as response:
                if response.status == 200:
                    data = await response.json()
                    
                    # OpenSearch format: [query, [titles], [descriptions], [urls]]
                    if len(data) == 4:
                        titles = data[1]
                        descriptions = data[2]
                        urls = data[3]
                        
                        if len(titles) > 0:
                            results = []
                            for i in range(len(titles)):
                                results.append({
                                    'title': titles[i],
                                    'snippet': descriptions[i],
                                    'url': urls[i]
                                })
                            
                            logger.info(f"[search_actions] Wikipedia OpenSearch for '{query}' returned {len(results)} results")
                            return results
            
            # If OpenSearch returns nothing, try full-text search
            logger.info(f"[search_actions] OpenSearch returned no results, trying full-text search for '{query}'")
            
            params = {
                'action': 'query',
                'list': 'search',
                'srsearch': query,
                'srlimit': limit,
                'format': 'json',
                'srprop': 'snippet'
            }
            
            async with session.get(api_url, params=params) as response:
                if response.status != 200:
                    logger.error(f"[search_actions] Wikipedia API error: {response.status}")
                    return []
                
                data = await response.json()
                search_results = data.get('query', {}).get('search', [])
                
                if not search_results:
                    logger.warning(f"[search_actions] No Wikipedia results found for '{query}'")
                    return []
                
                results = []
                for result in search_results:
                    title = result.get('title', '')
                    snippet = result.get('snippet', '').replace('<span class="searchmatch">', '').replace('</span>', '')
                    url = f"https://en.wikipedia.org/wiki/{title.replace(' ', '_')}"
                    
                    results.append({
                        'title': title,
                        'snippet': snippet,
                        'url': url
                    })
                
                logger.info(f"[search_actions] Wikipedia full-text search for '{query}' returned {len(results)} results")
                return results
        
    except Exception as e:
        logger.error(f"[search_actions] Wikipedia search failed: {e}", exc_info=True)
        return []
